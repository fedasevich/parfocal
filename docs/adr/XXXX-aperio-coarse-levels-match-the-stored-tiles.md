# XXXX. Aperio coarse levels match the stored tiles, not OpenSlide's resampled read

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-055 (JPEG 2000 coarse level differences from OpenSlide). Builds on [ADR 0111](0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md) (JPEG 2000 in the decode workers), [ADR 0310](0310-converted-jpeg-2000-slides-are-lossless-and-keep-the-source-levels.md) (converted JPEG 2000 slides are lossless and keep the source levels) and [ADR 0316](0316-jpeg-2000-slides-stay-native.md) (JPEG 2000 slides stay native).

## Context

VIEW-011 (SVS JPEG 2000 through OpenJPEG WASM) found single tiles at levels 1 and 2 of `JP2K-33003-1.svs` and `JP2K-33003-2.svs` up to 47 grey levels from OpenSlide, while level 0 was within 0.5. INGEST-015 (conversion fallback worker) then found that OpenSlide divides a level 0 location by the exact downsample, 4.0004 or 8.0018 on these slides, so every coarse read away from (0, 0) starts at a fraction of a pixel and is resampled. It decoded those levels from their codestreams instead, with OpenSlide's own YCbCr tables. ADR 0316 keeps JPEG 2000 slides native, so the browser decodes the same codestreams. Aperio JPEG slides have the same fractional downsamples, 4.0001 and 16.0005 on `CMU-1.svs`.

The browser reader and the INGEST-009 (seams and correctness check) reference had to agree on what a coarse level is. The reference windows were OpenSlide reads, so on coarse Aperio levels they were resampled.

## Options considered

1. The browser matches the stored tiles, and the server reference decodes the stored tiles on coarse Aperio levels.
2. The browser matches OpenSlide by resampling each coarse level by the fractional downsample.
3. Leave both as they are and keep the mean error check only.

## Decision

Option 1. The [result](../results/2026-11-15-jpeg-2000-coarse-level-differences.md) shows the difference follows where OpenSlide is asked to read and not the decoder. The same codestream decode is 0 from OpenSlide at (0, 0) and 43 to 46 from it at the whole-downsample locations VIEW-011 used, except 7 on level 1 of `JP2K-33003-2.svs`. The browser reader is within 3 grey levels of the codestream at every level of both slides, and its level table equals the TIFF pages. On `CMU-1.svs` the stored JPEG tiles decoded by Pillow equal OpenSlide at each level's origin, and the browser's script decoder is within 1 grey level of them at every level.

- The stored tiles are what the scanner wrote. A resampled read is a property of one reader's location arithmetic, and it is not even stable inside OpenSlide, since it changes with the location and with the 4096 px pieces a read is split into.
- The converted store of ADR 0310 already takes JPEG 2000 levels from the codestream. With option 1 the native browser view, the converted store and the reference are the same pixels.
- Option 2 would blur every coarse tile by a sub-pixel shift for no gain in placement. Placing a level at its whole downsample instead of the exact one moves its far edge by under one pixel of that level on these slides, at most 15 level 0 pixels on level 2 of `JP2K-33003-2.svs` (32671 against 2041 × 16), and nothing at the origin.
- Option 3 cannot tell the two references apart. The browser was a mean of 0.98 from the old OpenSlide window of `JP2K-33003-1.svs`, under the 1.0 limit, and 14 at its largest. On `CMU-1.svs` it was a mean of 0.33 and a largest of 19 from the old level 1 window.

Built with it:

- `reference_tiles.py` cuts a window on an Aperio level whose OpenSlide downsample is not whole from the stored JPEG or JPEG 2000 tiles, decoding only the tiles the window touches, through `aperio_window` in `source_levels.py`. A JPEG tile is joined with the page's JPEG tables and decoded by Pillow, as RGB without a colour transform when the page's photometric is RGB, as Aperio writes it. Every other level and format keeps its OpenSlide or tifffile read.
- Aperio slides with JPEG or JPEG 2000 tiles get a reference window on every level, not the usual two, and `JP2K-33003-2.svs` joins the reference fixtures.
- The reader check reports the largest difference of each window as well as the mean. On the Aperio slides every level is held to a mean of 0.5 and a largest difference of 3 for JPEG 2000 and 1 for JPEG.

## Consequences

- The browser keeps reading coarse Aperio levels as stored, with no change to the decoders or the level table.
- A JPEG 2000 residual of 1 to 3 grey levels remains at every level, including level 0. It is assumed, not traced, to come from the OpenJPEG WASM build converting YCbCr with its own arithmetic instead of OpenSlide's fixed point table. It is under the agreement limit and is not changed here.
- The JPEG bound of 1 holds for the script decoder the reader check uses (`nativeJpeg: "off"`). The browser's native JPEG decode is covered by its own agreement threshold, not by this bound.
- Window placement is unchanged. Coarse level pixel x still covers level 0 from x times the whole downsample, as before, which matches how the viewer places levels.
