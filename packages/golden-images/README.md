# Golden images

Golden-image rendering checks for TEST-005 (golden-image rendering tests). A test renders a slide view to a canvas, captures the frame, checks that it is not empty and compares it with a stored PNG under the tolerance of the slide's format. The comparison method is in [ADR 0101](../../docs/adr/0101-golden-image-comparison.md).

## Commands

```
pnpm --filter @parfocal/golden-images test           # unit tests of the comparison, no browser
pnpm --filter @parfocal/golden-images test:browser   # the golden suite in headless Chrome on SwiftShader
pnpm golden:update                                   # rewrite every golden image from the current renderer
```

`pnpm test:browser` at the root runs this suite and the latency-proxy perf suite, as the `browser` CI job does.

## Regenerating golden images

1. Make the rendering change and run `pnpm --filter @parfocal/golden-images test:browser`. A failing scene writes `<scene>.actual.png` and `<scene>.diff.png` into `test-results/`. Magenta pixels in the diff differ by more than the format's per-channel limit.
2. If the change is intended, run `pnpm golden:update`. It refuses to write a frame that fails the empty-frame check.
3. Open the changed files in `goldens/` and look at them before committing. A golden is only as good as the review of its first version.
4. Run the suite again without `GOLDEN_UPDATE` and commit the PNGs with the change that caused them, and say why in the commit message.

Goldens can be written on a Mac or on Linux, because the suite always renders with SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`) and fails when WebGL runs on anything else. `GOLDEN_MEASURE=1 pnpm --filter @parfocal/golden-images exec playwright test render/measure.spec.ts` prints how far the hardware GPU and a channel-swapped renderer are from the goldens.

## Plugging in a renderer

The suite only needs a page that draws a view and a way to read the frame back.

| Piece | Where |
|---|---|
| A scene: name, slide format and view | `render/scenes.ts` |
| Drawing | Any page. The reference renderer in `src/reference-renderer.ts` draws one RGB tile with WebGL2 |
| Capture | `captureWebglCanvas(page, selector)` reads the WebGL drawing buffer with `readPixels`, which needs `preserveDrawingBuffer: true`. `captureScreenshot(locator)` works for any canvas, WebGPU included, and matched `readPixels` exactly on SwiftShader |
| Empty-frame guard | `assertFrameHasContent(frame)` rejects cleared, uniform and transparent frames before any comparison, which is the failure doc 23 found timing faster than a real frame |
| Comparison | `checkGolden(frame, { name, format, goldenDirectory, outputDirectory })` |

When the Viv route exists, its spec opens the route with a known slide and view, waits for the viewer's loaded signal and calls the same two functions. Each real slide format then gets its own scenes and goldens, and the tolerance comes from `FORMAT_CODECS` and `CODEC_TOLERANCES` in `src/tolerances.ts`.

## Tolerances

A pixel differs when any of R, G or B is further than `maxChannelDelta` from the golden. A frame passes when no more than `maxDifferingFraction` of its pixels differ and the mean error of every channel stays under `maxMeanChannelError`.

| Codec | Max channel delta | Differing pixels allowed | Mean error per channel | Formats |
|---|---|---|---|---|
| lossless | 2 | 0.1% | 0.25 | synthetic tiles, OME-TIFF, OME-Zarr, Huron uncompressed |
| jpeg | 4 | 0.5% | 1.0 | SVS JPEG, NDPI, MRXS, SCN, BIF, Philips TIFF, generic JPEG TIFF, CAMELYON16 TIFF |
| jpeg2000 | 6 | 1% | 1.5 | SVS JPEG 2000 |

These are starting values chosen before a real decoder exists. The lossless row is wider than the measured SwiftShader noise, which was zero, so it absorbs a backend change of 1 level ([result](../../docs/results/2026-10-23-golden-image-tolerances.md)). TODO: tune the jpeg and jpeg2000 rows when the Viv route decodes real fixtures. A swapped R and B channel gives a mean error above 26 on every synthetic scene, so it fails all three rows.
