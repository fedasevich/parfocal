# Result: renderer route switch memory

- Date: 2026-11-14
- Backlog: VIEW-036 (renderer interface and route switching)
- Kind: baseline
- Commit: 407e5948
- Environment: 24 GB Mac, Darwin 24.6.0, Playwright headless Chromium on ANGLE Vulkan SwiftShader, no network shaping, other agents running on the same machine
- Data: `CMU-1-Small-Region.svs` from the fixture cache (public test slide, no PHI)

## Question

Does switching the renderer route on an open slide keep the heap within 10% of the warmed-up baseline and leave one canvas and one live `Deck`, as [ADR 0103](../adr/0103-memory-settings-and-test-baseline.md) (memory settings and test baseline) asks of every memory test?

## Method

`pnpm --filter @parfocal/viewer-engine exec playwright test route-switch` runs `browser/route-switch.spec.ts`. The page opens the slide on the first registered route at camera x 1100, y 1500, zoom -1, then calls `engine.switchRenderer` and `engine.whenIdle` once per round, cycling through the registered routes. After each round the test forces a garbage collection over CDP, reads the heap and counts live `Deck` objects with `Runtime.queryObjects`. The baseline is the last warm-up round. Only the Viv route is registered, so every switch is Viv to Viv. The soak is the same spec with `ROUTE_SWITCHES=60`, run before the warm-up was raised from one switch to five.

## Results

| Run | Rounds | Warm-up | Baseline heap | Last heap | Growth | Decks per round | Canvases per round | Switch time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Final spec | 15 | 5 | 7.4 MB | 7.8 MB | 5.3% | 1 | 1 | 633 to 670 ms |
| First run | 11 | 1 | 7.2 MB | 7.8 MB | 8.3% | 1 | 1 | about 620 to 650 ms |
| Soak | 61 | 1 | 7.2 MB | 7.8 MB | 7.9% | 1 | 1 | not recorded |

After dispose every run had 0 live decks and 0 canvases. The camera was identical after every switch and no error was reported. In the final run the heap was 7.2 MB after round 1, 7.4 MB in rounds 4 to 7 and 7.8 MB from round 9 to round 15. In the soak it stayed at 7.8 MB from about round 8 to round 61.

## Interpretation

The heap steps up once in the first eight or nine switches and then stays flat, so the switch does not leak. All three runs are inside the 10% budget. The switch time is dominated by SwiftShader redrawing the tiles and says nothing about a real GPU. No switch between two different routes has been measured, because no second route exists.

## Follow-ups

[ADR 0302](../adr/0302-renderer-routes-switch-inside-the-engine-behind-lazy-loaders.md) (renderer routes switch inside the engine behind lazy loaders). TODO: rerun when VIEW-037 (deck.gl 9.4 WebGPU route) or VIEW-038 (custom WebGPU engine route) registers a loader, which makes the same spec cycle across routes without a change.
