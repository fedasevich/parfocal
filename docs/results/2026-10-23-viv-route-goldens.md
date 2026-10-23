# Result: the Viv route draws CMU-1.svs identically on every SwiftShader run, and swapped, unconverted or misplaced pixels all fail its goldens

- Date: 2026-10-23
- Backlog: VIEW-002 (Viv route on WebGL2 for RGB brightfield)
- Kind: baseline
- Commit: 8d68193 plus the uncommitted VIEW-002 changes in `packages/viewer-engine/src/viv` and `packages/golden-images`
- Environment: MacBook with Apple M4, macOS 15.8.1, Node 26.9.0, Google Chrome 155.0.8059.86 headless through Playwright 1.64.0 with `channel: "chrome"`. WebGL2 on `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)`, and for the hardware row `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`. Viewport 800 × 600 at a device pixel ratio of 1. Viv 0.23.0, deck.gl 9.4.0, luma.gl 9.4.2, geotiff 3.0.5. Localhost, no network shaping
- Data: `CMU-1.svs` (46,000 × 32,914, 0.499 µm per pixel, JPEG levels at 1x, 4x and 16x) and `CMU-1.tiff` (the same slide stored as YCbCr JPEG) from the OpenSlide test data, fetched with `pnpm fixtures`

## Question

Do golden images of the fitted, 10x and 40x views of CMU-1.svs through the Viv route stay stable on SwiftShader, which JPEG tolerance row of [ADR 0101](../adr/0101-golden-image-comparison.md) they need, and does each kind of broken route fail them? ADR 0101 set the JPEG row (max channel delta 4, 0.5% of pixels, mean error 1.0) before any real slide was drawn.

## Method

`packages/golden-images/render/viv-measure.spec.ts` starts the Vite harness in `packages/golden-images/harness/viv`, which mounts `createViewerEngine` with the Viv route on an 800 × 600 element, opens the slide through the default PixelSource registry, sets the view and waits for `route.whenIdle()`. The frame is an element screenshot of the canvas over the page's `#f2f2f2` background. Each scene is rendered five times per variant and the worst comparison against the stored golden is kept. Open to idle is measured around the harness call, from opening the slide to idle.

```sh
pnpm fixtures viewer
GOLDEN_MEASURE=1 pnpm --filter @parfocal/golden-images exec playwright test render/viv-measure.spec.ts
```

| Scene | Camera |
|---|---|
| `viv-cmu-1-svs-fit` | `fitCamera`, the whole slide in 800 × 600 |
| `viv-cmu-1-svs-10x` | centre (28,750, 10,700), zoom `log2(0.499 × 10 / 10)` ≈ −1.003 |
| `viv-cmu-1-svs-40x` | centre (28,750, 10,700), zoom `log2(0.499 × 40 / 10)` ≈ 0.997 |

The broken variants wrap the PixelSource in the harness: `swap-red-blue` swaps planes 0 and 2, `ycbcr-as-rgb` turns the RGB planes into JFIF Y, Cb and Cr, as a reader that skipped `readRGB` would, and `wrong-level` reports the 4x level as a 2x level, the POC's ladder bug.

## Results

| Scene and variant | WebGL | Max channel delta | Mean error R / G / B | Pixels over delta 4 | JPEG row | Open to idle min / median / max | Empty-frame check |
|---|---|---|---|---|---|---|---|
| fit | SwiftShader | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass | 860 / 878 / 1,226 ms | content |
| 10x | SwiftShader | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass | 759 / 775 / 779 ms | content |
| 40x | SwiftShader | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass | 473 / 477 / 479 ms | content |
| fit, R and B swapped | SwiftShader | 105 | 4.025 / 0.000 / 4.025 | 15.491% | fail | 857 / 862 / 872 ms | content |
| 10x, R and B swapped | SwiftShader | 101 | 15.632 / 0.000 / 15.632 | 73.857% | fail | 764 / 771 / 779 ms | content |
| 40x, R and B swapped | SwiftShader | 117 | 18.161 / 0.000 / 18.161 | 78.164% | fail | 470 / 472 / 478 ms | content |
| fit, YCbCr as RGB | SwiftShader | 135 | 6.531 / 94.289 / 92.686 | 95.667% | fail | 899 / 912 / 923 ms | content |
| 10x, YCbCr as RGB | SwiftShader | 147 | 26.734 / 42.398 / 34.268 | 100.000% | fail | 797 / 803 / 812 ms | content |
| 40x, YCbCr as RGB | SwiftShader | 169 | 26.514 / 51.355 / 42.721 | 100.000% | fail | 601 / 604 / 613 ms | content |
| fit, 4x read as 2x | SwiftShader | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass | 878 / 893 / 903 ms | content |
| 10x, 4x read as 2x | SwiftShader | 251 | 85.425 / 129.510 / 92.805 | 99.994% | fail | 452 / 470 / 485 ms | empty (uniform white) |
| 40x, 4x read as 2x | SwiftShader | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass | 491 / 592 / 629 ms | content |
| fit | Metal | 9 | 0.080 / 0.082 / 0.067 | 0.045% | pass | 894 / 942 / 961 ms | content |
| 10x | Metal | 6 | 0.389 / 0.411 / 0.310 | 0.011% | pass | 790 / 796 / 810 ms | content |
| 40x | Metal | 3 | 0.168 / 0.166 / 0.117 | 0.000% | pass | 479 / 516 / 526 ms | content |

`CMU-1.tiff` (YCbCr JPEG) at the 10x camera against the CMU-1.svs 10x golden, one run in `viv-cmu1.spec.ts`: max delta 41 / 28 / 40, mean error 4.33 / 2.76 / 4.93, 67.4% of pixels over delta 4, no channel permutation hint.

Production build of the harness (`vite build harness/viv`): main chunk 1,210,005 bytes minified. The build has two chunks each for the geotiff decoders `jpeg` (8,708 and 10,808 bytes), `lerc` (44,489 and 73,918), `lzw`, `deflate`, `packbits`, `raw` and `webimage`.

## Interpretation

- SwiftShader is deterministic for the Viv route as it was for the reference renderer, so the JPEG row has room for the M4 to x86 runner difference that ADR 0101 still has to check. Metal stayed inside the JPEG row on all three views, with up to 0.045% of pixels past delta 4.
- The JPEG row is kept as it is. A swap fails it by 4 to 18 times the allowed mean error, YCbCr handed over as RGB by 6 to 94 times.
- The fitted view is the weakest detector of a channel swap (mean 4.0), because most of the frame is near-white glass where R and B are almost equal. The 10x and 40x views carry the colour checks.
- Reading the 4x level as 2x only touches views that use the 2x and 8x virtual levels, so only the 10x view fails, and it fails as an empty frame because the misplaced window falls outside the stored 4x level at that centre. A wrong ladder elsewhere on the slide would draw tissue from the wrong place, which the 10x golden would also reject.
- CMU-1.tiff is the same slide re-encoded, so its 4 to 5 levels of mean error against the SVS golden come from the second JPEG encoding. Assumption: a skipped YCbCr transform on it would give errors like the YCbCr-as-RGB rows (26 or more), which the test's bound of 10 separates.
- Assumption, not checked: the duplicate decoder chunks are geotiff 2.1.3 from `@vivjs/loaders` next to geotiff 3.0.5. `@vivjs/loaders` keeps `"sideEffects": false` under `publishConfig` in its installed `package.json` and calls `addDecoder` at module level. A build with `moduleSideEffects` turned off for `@vivjs/loaders` gave the same chunks, so the cause is not settled.

## Follow-ups

- [ADR 0102](../adr/0102-viv-route-feeds-a-virtual-rgb-ladder.md) records how the route feeds Viv.
- TODO: the first `browser` CI run on hosted x86 SwiftShader must match these goldens written on the M4.
- TODO: find where the second geotiff decoder set comes from and drop it from the web app bundle (ADR 0098 asked VIEW-002 to check, and the answer so far is "probably yes").
- TODO: open to idle is main-thread decoding and averaging. VIEW-004 (decode worker pool) owns the speed.
