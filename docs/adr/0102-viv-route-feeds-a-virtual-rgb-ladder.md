# 0102. The Viv route hands MultiscaleImageLayer a virtual power-of-two ladder of interleaved RGB tiles built from our PixelSource

- Date: 2026-10-23
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-002 (Viv route on WebGL2 for RGB brightfield). Touches VIEW-004, VIEW-005, VIEW-010, VIEW-030, VIEW-036 and TEST-005.

## Context

VIEW-002 asks for a Viv route driven by our `PixelSource` ([ADR 0099](0099-tiff-and-zarr-readers-in-the-browser.md)) with a camera the engine controls ([ADR 0100](0100-viewer-hot-path-state-outside-react.md)), on the versions of [ADR 0098](0098-viv-and-deck-gl-versions.md), proven by golden images of CMU-1.svs on SwiftShader in CI ([ADR 0101](0101-golden-image-comparison.md)).

Four things had to be settled. Viv's `MultiscaleImageLayer` addresses tiles by `z = -i` and treats loader entry `i` as exactly a `2^i` downsample, while Aperio stores 1x, 4x and 16x. Viv 0.23 can take RGB as one interleaved texture or as three planes. The geotiff source already turns YCbCr into RGB, and Viv's bitmap shader can do the same. And CMU-1.svs (170 MB) is only in the `formats` fixture group, which only the `formats` CI job fetches.

## Options considered

The level ladder:

1. Hand Viv the real levels as consecutive entries. Nothing to build, but the 4x level lands where Viv expects 2x and the slide tears apart as it zooms (POC `src/viv/tiff-source.ts`).
2. A virtual `2^i` ladder where each entry reads the finest real level not finer than it and lets geotiff resample with `resampleMethod: "nearest"`, as the STACK-015 spike did. Small, but nearest sampling aliases fine texture at the in-between levels and ties the route to geotiff, so the Zarr source would need its own resampling.
3. The same virtual ladder over `PixelSource.getRaster`, with an integer box average done in our code. Works for every source, matches what ingest and the POC did, and is plain to test. It costs CPU on the main thread at the in-between levels (factor 2 for CMU-1.svs) and grows to a factor of 16 at the coarsest virtual level.

The pixel layout:

1. Three planes through Viv's `XRLayer` with a colour per channel, as the POC did on Viv 0.22. Viv asks `getTile` once per channel, so every tile is decoded or copied three times unless a cache in front absorbs it, and 8-bit textures need the `r8unorm` patch of POC doc 24.
2. One interleaved RGB tile (`shape [h, w, 3]`, labels `y, x, _c`), which Viv 0.23 draws through its `BitmapLayer`. One call per tile, no contrast or colour mapping to get wrong, and the `r8unorm` patch does not apply.

Where YCbCr becomes RGB:

1. Pass raw Y, Cb and Cr and set `meta.photometricInterpretation` to 6, so Viv's shader converts. The conversion then runs after linear texture filtering, every other route needs its own copy, and VIEW-005's native decoder, which already returns RGB, would have to switch the flag back.
2. The PixelSource always returns RGB (it uses `readRGB` for YCbCr files, ADR 0099 row 1) and the route always tells Viv 2. One place converts, for every route.

Getting CMU-1.svs to the `browser` job:

1. Restore the `formats` cache (about 2.3 GB) in the `browser` job. No manifest change, but every browser run would restore 2.3 GB to read one file.
2. Commit a cropped SVS. Small, but it is not the slide the "Done when" line names, and a crop changes the pyramid.
3. A new `viewer` fixture group holding only the slides the browser goldens open, cached under its own key, as the `formats` job does with its group. CMU-1.svs stays in `formats` too.

## Decision

Ladder option 3, layout option 2, YCbCr option 2 and fixture option 3.

- `packages/viewer-engine/src/viv/viv-levels.ts` builds the ladder (`virtualLadder`), averages and interleaves in one pass (`boxDownsampleToInterleaved`), paints absent tiles as white glass and maps an aborted request to Viv's `__vivSignalAborted` sentinel, which Viv swallows instead of reporting a tile error. Sources that are not 8-bit RGB are refused with `UnsupportedVivSourceError` until a multichannel route exists.
- `viv-route.ts` implements the engine's `RendererRoute`. It owns one `Deck` with an `OrthographicView`, `controller: false` and a controlled `viewState` of `{ target: [x, y, 0], zoom }`, which is the engine camera unchanged because both use slide pixels and `2^zoom` screen pixels per slide pixel. It adds `whenIdle()`, which resolves after two calm frames once the layer is loaded, no tile read is in flight and deck has nothing left to draw.
- A magnification M shows `10 / M` µm per screen pixel, so 10x is 1 µm per screen pixel, the rule ingest uses to estimate objective power (`zoomForMagnification`). CMU-1.svs is scanned at 0.499 µm per pixel, so its 40x view enlarges the base level about twofold.
- Goldens are captured with an element screenshot, so the route does not need `preserveDrawingBuffer`.
- The `browser` CI job restores `fixtures-viewer-<hash>`, runs `pnpm fixtures viewer` and runs `pnpm test:browser` with `PARFOCAL_REQUIRE_FIXTURES=viewer`, so a missing CMU-1.svs fails instead of skipping.

The [result](../results/2026-10-23-viv-route-goldens.md) has the numbers: the three CMU-1.svs views were byte-identical to their goldens on SwiftShader in five runs each, a red and blue swap missed by 4.0 to 18.2 levels of mean R and B error, YCbCr handed over as RGB by 6.5 to 94.3, and Metal stayed within the JPEG tolerance.

## Consequences

- The route ships in `@parfocal/viewer-engine/viv`, a separate export, so the main entry stays importable from Node tests without deck.gl.
- The route releases its deck with `disposeDeck` from `src/viv/dispose-deck.ts`, which VIEW-030 (memory and teardown correctness) owns.
- VIEW-004 (decode worker pool) should move the box average with the decode, because the coarsest virtual level of CMU-1.svs averages a 16x level by 16 on the main thread.
- VIEW-005 (native JPEG decode) keeps returning RGB, and the route keeps telling Viv 2.
- VIEW-010 (SVS JPEG) and the other per-format tasks add their goldens to `render/viv-scenes.ts` and add their slides to the `viewer` group when CI must run them. The group's size is capped at 256 MB by a manifest test.
- VIEW-036 (renderer interface) can take `whenIdle` into the shared interface, since every route needs a "settled" signal for goldens and perf tests.
- The harness bundle carries two copies of each geotiff decoder chunk, which suggests geotiff 2 from `@vivjs/loaders` is bundled next to geotiff 3. TODO: confirm and remove it in the web app build, as ADR 0098 asked.
