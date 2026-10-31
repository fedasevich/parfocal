# 0111. JPEG 2000 decodes in the decode workers through OpenJPEG WebAssembly, and OME-TIFF channel pages become channels

- Date: 2026-10-26
- Status: Accepted
- Deciders: owner
- Backlog: VIEW-011 (SVS JPEG 2000 through OpenJPEG WASM), VIEW-010 (generic tiled TIFF and SVS JPEG), VIEW-012 (OME-TIFF 8-bit and 16-bit)

## Context

geotiff.js has no JPEG 2000 decoder, so Aperio SVS files with compression 33003 or 33005 opened and then failed on the first tile ([ADR 0099](0099-tiff-and-zarr-readers-in-the-browser.md), workaround 7, which named this task as the fix). Roughly a quarter of TCGA is stored this way. The POC solved it with OpenJPEG compiled to WebAssembly and a grey placeholder for damaged tiles (`poc/src/slide/codecs/openjpeg.ts`). The decode workers of [ADR 0105](0105-decode-workers-behind-one-byte-cache.md) already keep decoding off the main thread.

The WebAssembly module is not small next to a decode worker, and most slides are JPEG. A slide that is not JPEG 2000 must not pay for it.

An OME-TIFF with several channels stores each channel as its own page, with the pyramid levels of that channel in the page's SubIFDs. The source read only the first of those pages and showed one grey channel.

## Options considered

1. `@cornerstonejs/codec-openjpeg` 1.3.6, the build the POC used. A 260,334 byte WebAssembly file (85,793 bytes gzipped) and 28,400 bytes of glue, MIT licence, decode only.
2. OpenJPEG built by this project. It gives control over the build flags and costs a toolchain and a recipe to maintain.
3. `jpx-medical` or `pdf.js`'s `jpx.js`. Pure JavaScript, much slower in the POC's experience, and tuned for PDF images.
4. Decode JPEG 2000 on the server and serve converted tiles. This is the conversion trigger of INGEST-014 and is not needed until the browser decode fails the VIEW-040 budgets.
5. For a damaged tile, throw and let Viv draw nothing. A hole in the picture looks like absent glass, and a tile that failed to decode is not glass.
6. For a damaged tile, return a flat grey. It is visibly not tissue and not glass.
7. For OME channels, wait for the multichannel display task. The source and its tests do not depend on a display.

## Decision

Option 1, with these rules.

- The decoder is registered with geotiff's `addDecoder` for compressions 33003 and 33005 and imported lazily by geotiff on the first tile. The OpenJPEG glue and the WebAssembly file are imported again from inside the decoder, so they are fetched when the first J2K tile is decoded and never for another format. With `worker.format: "es"` Vite emits them as separate files, which a browser test proves by listing the requests of a J2K slide and of JPEG and deflate slides.
- The decoder refuses to run when the realm has a `document` and throws `MainThreadCodecError`. There is no main-thread fallback. The page can still open a J2K slide, because the open check skips JPEG 2000, and a read on the page fails loudly.
- A tile with no codestream marker, a decode error, or a decode that gives a different size or sample count is damaged. The decoder returns a flat grey of 160 out of 255 at the sample width of the file (160 times 257 for 16-bit) and counts it. A WebAssembly runtime error also drops the cached module so that the next tile instantiates a fresh one.
- Colour is applied once, by OpenJPEG. The build converts Aperio's YCbCr (33003) to RGB itself and applies the codestream's own transform for 33005, so the source returns the samples as they are and never calls `readRGB` for these files. Against OpenSlide the mean absolute error was 0.40 to 0.48 per tile at level 0 of JP2K-33003-1.svs and 0.00 to 0.05 on CMU-1-JP2K-33005.svs ([result](../results/2026-10-26-jpeg-2000-in-the-decode-workers.md)). The standard TIFF compression 34712 stays refused with `UnsupportedCodecError`, because its payload may be a JP2 file and has no fixture.
- An OME-TIFF whose XML lists several channels of one sample each, with the channel as the fastest dimension or no Z and T stack, becomes a source with photometric `channels`. Each channel is the page `base + channel` at the same sub level, its name and colour come from the XML, and a window reads all channel pages in parallel. Absent tiles follow the first channel's byte counts.
- A multichannel source feeds Viv through `createVivChannelLevels` and `vivChannelLayerProps` in `src/viv`. Levels are `c, y, x` with `Uint8` or `Uint16` data, and the layer props carry the per-channel contrast limits, colours and visibility that Viv's channel path expects.

## Consequences

- `@cornerstonejs/codec-openjpeg` is a dependency of `@parfocal/viewer-engine`. Vite prints two warnings that the package's Node branches import `fs` and `path`. They are never reached in a browser.
- Any Vite build that bundles the decode worker needs `worker: { format: "es" }`, as `apps/web` already has. The viewer-engine harness build now has it too.
- The Viv route in `src/viv/viv-route.ts` still draws RGB only and the decode workers still read interleaved RGB regions. A multichannel slide is drawn today by the page-side levels in a plain Deck, which the browser test uses. Moving channel reads into the workers and mounting channel levels in the route belong to the multichannel display task (VIEW-018).
- Decoding speed of J2K in the browser is not measured here. INGEST-014 (JPEG 2000 performance decision) needs a measurement against the VIEW-040 budgets.
- Four fixtures were added: two valid J2K TIFFs, one with a damaged tile with no marker and one with a garbled body, and two OME-TIFFs with three 8-bit and three 16-bit channels. The synthetic `33003` file is tifffile output with the multiple component transform on, so it checks the compression routing and not the YCbCr layout. The real `JP2K-33003-1.svs` checks the colour and skips when it is not cached.
- New goldens: `viv-cmu-1-jp2k-33005-svs-10x`, `viv-jp2k-33003-1-svs-fit`, `viv-synthetic-jp2k-damaged-fit`, `viv-cmu-1-tiff-10x`, `viv-synthetic-jpeg-tiff-fit` and `viv-synthetic-sparse-tiff-fit`. The two real J2K goldens and `viv-cmu-1-tiff-10x` need the `formats` fixture group and skip without it.
