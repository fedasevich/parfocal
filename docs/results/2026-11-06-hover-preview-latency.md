# Result: Hover preview latency from pointer to outline on WebGPU in Chrome

- Date: 2026-11-06
- Backlog: AISEG-006 (hover preview)
- Kind: benchmark
- Commit: a02e3fcc
- Environment: MacBook with Apple M4 (10 logical cores), macOS 15.8.1, Google Chrome 156 in headless mode driven by `@playwright/test` 1.64.0 with `--enable-unsafe-webgpu`. The WebGPU adapter reported vendor `apple`, architecture `metal-3`. The page was cross-origin isolated and the app's real inference worker (`createSamClient`) started on the WebGPU provider without falling back. Other agents shared the machine, so times are indicative only
- Data: the first 8 TNBC patches (512 by 512 pixels, public, no PHI) from `parfocal_ml.datasets`, 78 nuclei with one realistic click each, the fixture of the AISEG-005 smoke test. The graphs are the ones from `python -m parfocal_ml.sam_onnx.export` in `~/.cache/parfocal/models/onnx`: the 4-bit encoder and the decoder

## Question

Does the hover preview of smart select show an outline in under 100 ms from the pointer, as [ADR 0011](../adr/0011-hosted-ci-only.md) (hosted CI only, so speed is checked by hand on the owner's Mac) and the backlog line require? The POC measured about 60 ms from the pointer event to the new outline (POC doc 15).

## Method

```
pnpm --filter @parfocal/web bench:hover
```

The page runs the real `createSmartSession` of the app with the real inference worker and the real graphs. The patch reader is a fake that serves the fixture patches side by side on one slide (patch i at x = 512 i), so the measurement leaves out tile reading, which hover never does anyway: hover runs only on a patch whose embedding is already cached.

For each of the 8 patches the page prewarms the patch (the encode is not part of the latency) and then, for each nucleus, clears the hover state and calls `session.hover` at the nucleus's realistic click point. The clock starts just before that call, which stands for the pointer move handler. It stops when the session hands the dashed outline to the render callback (`onHover`), which is the work up to the moment React would draw it. A second figure adds the wait for the next animation frame. Every hover decodes one point on the cached embedding in the worker, picks the best of four masks, traces the contour and simplifies it into a slide ring. Each nucleus is then hovered a second time at the same point to time the prompt cache. A last sweep sends 40 pointer moves 16 ms apart to new pixels without awaiting any of them, to check that one request is in flight and only the latest position is kept.

The test asserts a median and a 95th percentile of the pointer-to-outline time under 100 ms and skips when the graphs or the fixture folder are absent. It is run on its own, never together with `pnpm verify`.

## Results

Pointer to outline in milliseconds over 78 hovers, none without an outline. The last of three runs on the same machine and code is the table. The two earlier runs gave a median of 48.4 and 43.2 and a 95th percentile of 54.5 and 55.0.

| Measure | n | min | median | p95 | max |
|---|---|---|---|---|---|
| Pointer to outline | 78 | 42.1 | 48.6 | 56.8 | 63.2 |
| Pointer to outline and next animation frame | 78 | 42.5 | 48.9 | 57.4 | 63.3 |
| Same point again (prompt cache hit) | 78 | 0 | 0 | 0 | 0 |
| Decoder pass inside the worker | 99 | 27.0 | 29.2 | 33.1 | 36.2 |
| Encode of one patch (not in the latency) | 8 | 1100.6 | 1111.0 | 1288.9 | 1288.9 |

The sweep sent 40 moves 16 ms apart to new pixels and caused 21 decodes. The outline for the final position was ready 52.9 ms after the last move.

## Interpretation

The pointer-to-outline time is 48.6 ms median and 56.8 ms at the 95th percentile on WebGPU, well under the 100 ms budget and in line with the POC's 60 ms. The decoder pass in the worker accounts for about 29 ms. The remaining 20 ms is the worker message, picking the best mask, tracing the contour and simplifying it. A cache hit is below the clock's resolution, so the click that follows a hover on the same pixel costs no second decode. The sweep shows that moves arriving faster than the decoder collapse to the latest position: 21 decodes for 40 moves, and no queue builds up behind the pointer.

The figures leave out the React render and the browser compositing of the dashed path, which the frame figure bounds at one more animation frame in headless Chrome. They do not cover the WebAssembly provider, where the decoder pass took 41 ms in the AISEG-005 smoke test, so the same pipeline should land around 60 ms, but this run did not measure it. A real hover on a full slide also reads nothing from the tile source, so the fake reader does not change the figure. Headless Chrome on a shared machine, one patch size and one model are the limits of the claim.

## Follow-ups

- TODO: repeat the run on the WebAssembly provider and on a Windows laptop with an integrated GPU, by hand on the owner's hardware.
