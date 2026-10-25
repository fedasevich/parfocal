# 0110. Native JPEG decode validated per file, and a slide opens fitted to its tissue

- Date: 2026-10-25
- Status: Proposed
- Deciders: owner
- Backlog: VIEW-005 (native JPEG decode with per-file validation), VIEW-006 (shared decode cache across channels), VIEW-048 (open fitted to the tissue)

## Context

geotiff's JavaScript JPEG decoder takes 50 to 250 ms for a window of 16 to 64 tiles, which the decode workers of [ADR 0105](0105-decode-workers-behind-one-byte-cache.md) now keep off the main thread. The browser's own decoder is much faster, but a TIFF tile is not always a JPEG file. Some writers keep the tables in the `JPEGTables` tag and leave each tile headless, and splicing them back the way libtiff does is wrong for Aperio SVS. The failure is silent. All three SVS fixtures decode to a plausible but wrong picture, with a mean absolute error of 49 to 60 levels ([result](../results/2026-10-25-native-jpeg-validation.md)).

The Viv route already hands Viv one interleaved RGB array per tile from [ADR 0102](0102-viv-route-feeds-a-virtual-rgb-ladder.md), so the planes are not requested one per channel.

A slide opens fitted to its whole scan today, which leaves a lot of empty glass on most slides. The ingest worker already computes a tissue mask (INGEST-012), but no delivery path to the browser exists yet.

## Options considered

1. Use the script decoder only. It is correct on every fixture and slow.
2. Use the native decoder for every JPEG TIFF. It is fast and wrong on every Aperio SVS file.
3. Decide from tags, such as the vendor or the presence of `JPEGTables`. Tags do not separate the Aperio case from the Philips, Argos, Leica and CAMELYON files that carry the same structures and decode correctly.
4. Validate each file once. Decode one tile both ways and keep the native decoder only if the two agree. This costs one tile fetch and two decodes per distinct table set.
5. For the fit, wait for the mask delivery path. This blocks the fit rule on unrelated work.
6. For the fit, take an optional level-0 bounding box from the caller and keep the margin and fit rule in the camera code.

## Decision

Option 4 for decoding.

- A TIFF source with 8-bit, three-sample, tiled JPEG levels probes before its first read, and the decode workers force the probe at open. It picks one whole present tile per distinct `JPEGTables` value, the one with the most compressed bytes among up to 24 sampled tiles.
- The native decoder is kept for the whole file only when the mean absolute error is at most 3 out of 255, which is the POC's threshold. Any other result, a decoder error, a missing decoder or no usable probe tile keeps the script decoder, and the reason is in the source's `decodeReport()`.
- Native reads decode every tile of a window with `createImageBitmap` (colour management off) and an `OffscreenCanvas`, crop the overlap and leave absent tiles as white glass. One failing tile makes that read fall back to the script decoder and counts in the report.
- The native decode returns RGB, so the colour transform is applied exactly once. A native decoder that handed back raw YCbCr fails the probe, which a unit test checks.
- `createImageBitmap` and `OffscreenCanvas` work in the decode workers in Chrome 155, so the decode stays off the main thread.
- `nativeJpeg: "off"` and `nativeJpeg: "unvalidated"` exist on `OpenRequest`. The second skips the probe so that tests can show that the validation is needed.

Option 6 for the fit.

- `EngineSlide` has an optional `tissue` box in level-0 pixels. `fitCamera` and the engine's fit on open use it through `tissueArea`, which clips the box to the slide and adds a margin of 5 percent of each side, half on each edge, again clipped to the slide. Without a box, or with an unusable one, the whole slide is fitted.
- The engine's fit on open and `fitToSlide` are one function, so `0` and the fit command use the same box once the key registry exists. The zoom-out limit stays at half of the whole-slide fit ([ADR 0106](0106-camera-bounds-and-feel-profiles.md)).
- `pixelSlide` and `createPixelSlideOpener` pass the box through from the caller.

Nothing is built for VIEW-006. Viv asks for one selection of one interleaved array, so each region is read once. A browser test counts 31 region reads for 31 regions at the fitted view of CMU-1.svs and 25 for 25 at 10x, and no region is read more than once. The same view dispatches the same number of jobs to the workers.

## Consequences

- Aperio SVS files stay on the script decoder, and the fast path applies to Philips, Argos, Leica SCN, generic TIFF and CAMELYON files. Huron-1-40x.tif also falls back, at an error of 5.44.
- Opening a slide in a worker costs one more tile fetch and two decodes per distinct table set, which the shared byte cache keeps to about one block.
- The CMU-1.svs tissue box for the golden test comes from the ingest worker's mask (515 by 719 cells of 64 pixels, box 1856, 256 to 44672, 31360). It is only 5 to 7 percent smaller than the slide on each axis, because CMU-1.svs is nearly all tissue and a few stray cells reach the edges. With the margin the fit raises the zoom by 2.3 percent and moves the centre 264 level-0 pixels to the right, so the golden proves the rule but shows little. A box that ignores specks is a job for the ingest mask.
- Open questions for the owner are the margin (5 percent of each side in total, which clips to the slide edge) and whether the fit should ignore specks.
- A mask delivery path and the box it yields wait for the upload and storage work. Until then the caller passes the box.
- Backlog tasks touched: VIEW-005, VIEW-006 and VIEW-048 as above. VIEW-006's Done-when line is met by a test, not by a cache.
