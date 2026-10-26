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

## The Viv route on real slides

`render/viv-cmu1.spec.ts` starts a Vite server on `harness/viv`, a page that mounts the viewer engine with the Viv route from `@parfocal/viewer-engine/viv` and serves cached fixtures with range requests under `/fixtures/`. Each scene in `render/viv-scenes.ts` names a fixture, a format id and a view (fitted, a magnification at a slide point, or a raw camera). The page waits for the route's `whenIdle()`, and the spec captures the canvas with `captureScreenshot` and calls `checkGolden`. The same spec renders deliberately broken routes (red and blue swapped, YCbCr handed over as RGB, the 4x level read as 2x) and expects each to fail.

The CMU-1.svs scenes need `pnpm fixtures viewer`. They skip when the slide is missing, unless `PARFOCAL_REQUIRE_FIXTURES` names the `viewer` group, as the `browser` CI job does. `GOLDEN_MEASURE=1 pnpm --filter @parfocal/golden-images exec playwright test render/viv-measure.spec.ts` prints the measurement table of the [Viv route result](../../docs/results/2026-10-23-viv-route-goldens.md). Each further slide format gets its own scenes and goldens, and the tolerance comes from `FORMAT_CODECS` and `CODEC_TOLERANCES` in `src/tolerances.ts`.

## Overlay layers over CMU-1.svs

`render/viv-overlays.spec.ts` uses a second page of the same Vite root, `harness/viv/overlays.html` with `overlays.ts`, a 400 x 300 viewer at the 10x tissue view. The synthetic layers are in `harness/viv/overlay-fixtures.ts`. There is one golden for each overlay kind (`viv-overlay-<kind>.png`) and one for all seven stacked (`viv-overlay-stack.png`), compared with a stricter tolerance than the slide's JPEG row because a pin is under 0.5% of a frame. The spec also checks that hiding every layer draws the bare slide byte for byte, that registration order and timing do not change the picture, that opacity fades between the two, and that removing a layer destroys its GPU resources. Regenerate only these goldens with `GOLDEN_UPDATE=1 pnpm --filter @parfocal/golden-images exec playwright test render/viv-overlays.spec.ts`, never with `pnpm golden:update`, which rewrites the slide goldens too. [ADR 0108](../../docs/adr/0108-overlay-layers-as-typed-data-over-deck-gl.md) has the design.

## Digital zoom and GPU loss

`render/viv-interpolation.spec.ts` tests the finest level sampling rule of [ADR 0112](../../docs/adr/0112-finest-level-sampling-and-webgl-context-recovery.md). Its page is `harness/viv/synthetic.html`, a procedural 2048 x 1536 slide (`harness/viv/synthetic-source.ts`) with hash noise at the finest level and black and white tiles at the coarser ones. The spec computes the expected colour of every screen pixel from the camera, so a blend, a seam or a one texel shift at a tile border fails, and checks that coarser levels draw only pure black and white. On CMU-1.svs it adds the goldens `viv-cmu-1-svs-80x` and `viv-cmu-1-svs-tile-corner-4x` and checks that every 4 x 4 block of the corner scene is one colour. A route with `interpolation: "linear"` (the breakage `linear-everywhere`) must fail all of them. The CMU-1.svs tests need `pnpm fixtures viewer`.

Regenerate only the three digital zoom goldens, never with `pnpm golden:update`, with `GOLDEN_UPDATE=1 pnpm --filter @parfocal/golden-images exec playwright test render/viv-cmu1.spec.ts -g "viv-cmu-1-svs-40x matches"` and `GOLDEN_UPDATE=1 pnpm --filter @parfocal/golden-images exec playwright test render/viv-interpolation.spec.ts -g "matches its golden"`.

`render/viv-gpu-loss.spec.ts` uses `harness/viv/gpu-loss.html` to lose and restore the WebGL context with `WEBGL_lose_context` and checks that the same frame, camera, slide and overlay come back with one live Deck, and that an impossible recovery ends in one `GpuUnrecoverableError`.

## Tolerances

A pixel differs when any of R, G or B is further than `maxChannelDelta` from the golden. A frame passes when no more than `maxDifferingFraction` of its pixels differ and the mean error of every channel stays under `maxMeanChannelError`.

| Codec | Max channel delta | Differing pixels allowed | Mean error per channel | Formats |
|---|---|---|---|---|
| lossless | 2 | 0.1% | 0.25 | synthetic tiles, OME-TIFF, OME-Zarr, Huron uncompressed |
| jpeg | 4 | 0.5% | 1.0 | SVS JPEG, NDPI, MRXS, SCN, BIF, Philips TIFF, generic JPEG TIFF, CAMELYON16 TIFF |
| jpeg2000 | 6 | 1% | 1.5 | SVS JPEG 2000 |

These are starting values chosen before a real decoder exists. The lossless row is wider than the measured SwiftShader noise, which was zero, so it absorbs a backend change of 1 level ([result](../../docs/results/2026-10-23-golden-image-tolerances.md)). The Viv route drew CMU-1.svs identically on every SwiftShader run, Metal stayed inside the jpeg row, and a swap or an unconverted YCbCr frame failed it by 4 to 94 times the mean error it allows, so the jpeg row stays as it is ([result](../../docs/results/2026-10-23-viv-route-goldens.md)). TODO: tune the jpeg2000 row when VIEW-011 (SVS JPEG 2000) decodes it. A swapped R and B channel gives a mean error above 26 on every synthetic scene, so it fails all three rows.
