# Result: finest level sampling and WebGL context recovery on the Viv route

- Date: 2026-10-26
- Backlog: VIEW-007 (interpolation rule), VIEW-034 (GPU error handling)
- Kind: baseline
- Commit: 03d8d64 plus uncommitted changes of the same day
- Environment: MacBook with Apple M4, macOS 15.8.1, Node 26.9.0, pnpm 12.9.1, Google Chrome 155.0.8059.86 (read from `browser.version()`) driven headless by `@playwright/test` 1.64.0 with `channel: "chrome"` and the SwiftShader flags of `packages/golden-images/src/playwright.ts`. Viewport 800 x 600 CSS pixels at a device pixel ratio of 1. Viv 0.23.0, deck.gl 9.4.0, luma.gl 9.4.2
- Data: `CMU-1.svs` from the `viewer` fixture group, and a procedural 2048 x 1536 RGB slide with 128 pixel tiles and 5 levels (`packages/golden-images/harness/viv/synthetic-source.ts`)

## Question

Does the Viv route draw the finest level with crisp pixels and no seam at tile borders when a texel is larger than a screen pixel, while every coarser level stays linear and never bleeds across a tile border (VIEW-007)? Does a lost and restored WebGL context bring the viewer back to the same view, and does an impossible recovery end in one error and not in a hang (VIEW-034)? There is no budget. The rule comes from POC doc 06.

## Method

Interpolation, in `packages/golden-images/render/viv-interpolation.spec.ts`:

1. The procedural slide has hash noise at level 0, so any blend or one texel shift changes a pixel. Levels 1 to 4 alternate black and white by tile, so any bleed across a tile border gives a grey pixel.
2. For each camera the test computes the expected colour of every screen pixel centre from the camera (`2^zoom` screen pixels per slide pixel, y down) and compares it with an element screenshot. Pixels whose centre lies within 0.02 of a texel boundary are skipped. A border pixel is one within 2 texels of a tile border.
3. The same run with `interpolation: "linear"` is the negative control.
4. On `CMU-1.svs` at zoom 2 with the camera on a tile corner (256 pixel tiles), every 4 x 4 screen block must be one colour, and the test counts blocks.
5. The golden suite was run before and after with `pnpm --filter @parfocal/golden-images test:browser`. The old goldens were copied before the change and compared with `pngjs` pixel by pixel.

Recovery, in `packages/golden-images/render/viv-gpu-loss.spec.ts`: the route opens `CMU-1.svs` at 10x with the AI proposals overlay. The test takes the `WEBGL_lose_context` extension from the canvas, calls `loseContext()`, waits for the route to report `lost`, calls `restoreContext()`, waits for `ready` and for `whenIdle()`, and compares an element screenshot with the one taken before the loss. Live Decks are counted with `Runtime.queryObjects` after `HeapProfiler.collectGarbage`, polled up to 20 times.

## Results

Finest level against the pixel oracle (rule on):

| View | Pixels checked | Wrong | Border pixels checked | Border wrong | Finest textures |
|---|---|---|---|---|---|
| 2x, camera on a tile corner | 480000 | 0 | 33024 | 0 | 16 |
| 4x, camera on a tile corner | 480000 | 0 | 22144 | 0 | 4 |
| 8x, camera on a tile corner | 480000 | 0 | 43776 | 0 | 4 |
| zoom 1.37, fractional centre | 442368 | 0 | 23528 | 0 | 8 |

Every finest texture had `magFilter` nearest and `minFilter` linear.

Negative control (`interpolation: "linear"`, 2x view): 479964 of 480000 pixels wrong, 32988 of 33024 border pixels wrong.

Coarser levels (rule on, linear levels only, procedural slide):

| Zoom | Pixels that are not pure black or white | Black | White | Level 1 textures |
|---|---|---|---|---|
| -1.2 | 0 | 240000 | 240000 | 48 |
| -1.3 | 0 | 240000 | 240000 | 48 |

`CMU-1.svs`, zoom 2, camera on a tile corner: 30000 blocks, 0 mixed, 59605 of 59650 neighbouring block pairs differ. With `interpolation: "linear"`: 30000 of 30000 blocks mixed.

Goldens, old against new (`pngjs`, any channel difference counts):

| Golden | Result |
|---|---|
| `viv-cmu-1-svs-40x.png` | 467022 of 480000 pixels differ by any amount (97.296%), largest channel difference 101, mean absolute difference 6.976 per channel. Against the old golden under the jpeg tolerance, 325728 pixels (67.860%) differ by more than 4 in a channel, with mean errors of 7.790, 7.816 and 5.321 in R, G and B |
| `viv-cmu-1-svs-80x.png`, `viv-cmu-1-svs-tile-corner-4x.png` | new |
| `viv-cmu-1-svs-10x.png`, `-fit.png`, `-tissue-fit.png` | identical |
| the 8 `viv-overlay-*.png` goldens | identical |
| the 4 `synthetic-*.png` goldens | identical |

Context recovery on `CMU-1.svs` with the overlay (SwiftShader):

| Check | Result |
|---|---|
| Frame after one loss and restore against the frame before | 0 differing pixels |
| Camera, slide id and overlay layer ids after the restore | equal to before |
| Errors reported through `onError` during one recovery | 0 |
| Canvases in the host, live Decks after one recovery | 1 and 1 |
| Three losses in a row | 3 recoveries, frame identical to the first |
| A fourth loss within 30 s | status `failed`, reason `repeated-loss`, 1 error of type `GpuUnrecoverableError`, 0 canvases, `whenIdle` resolved, later route calls did not throw |
| No restore within 500 ms (test setting) | status `failed`, reason `restore-timeout`, 1 error, 0 canvases |
| Camera moved while lost | drawn after the restore (more than 1000 pixels differ from the home frame), and the home frame returns byte for byte |
| Loss while the loop sleeps | recovered, and the loop slept again |
| Dispose after a recovery | 0 Decks, 0 canvases, 0 of the guard's listeners |
| Dispose while lost, after waiting 800 ms with a 300 ms restore timeout | 0 Decks |

Unit tests: `@parfocal/viewer-engine` runs 551 tests and all pass. The new files add `interpolation.test.ts` (7), `gpu-recovery.test.ts` (9) and `webgpu-errors.test.ts` (6) to the 529 that were there. `@parfocal/golden-images` runs 19 and all pass, 4 of them the new `blocks.test.ts`.

## Interpretation

The rule works because Viv hands every tile sublayer its `tileId.z`, and `z === 0` is the finest level. At 40x on `CMU-1.svs` the finest level is magnified about twofold, so the 40x golden is the one frame that changes. The 10x views use level 1 and stay identical. The 97% share is high because linear magnification changes nearly every pixel by at least one level, and the mean difference of 7 per channel is what removing smoothing from JPEG tissue costs.

The synthetic coarse levels prove the half-texel guarantee holds without an inset, because a repeat or atlas style sampler would turn border pixels grey, and none of 480000 pixels was. The tests do not run a variant with `repeat` addressing, so the claim that such a variant would fail is an assumption.

A lost context is only restored when the page cancels the loss event, which luma.gl does not do. Recovery by a fresh canvas worked on the first design in SwiftShader. Reusing the canvas was not tried. The behaviour of a real GPU process crash on hardware is not measured.

## Follow-ups

- [ADR 0112](../adr/0112-finest-level-sampling-and-webgl-context-recovery.md) records the decisions.
- TODO: repeat the recovery run on a hardware GPU and with a real hidden tab in headed Chrome (VIEW-052, hidden tab check in headed Chrome).
- TODO: the owner confirms nearest magnification with linear minification at the finest level, the wording of the failure message and the limits of 5 seconds and 3 losses in 30 seconds.
