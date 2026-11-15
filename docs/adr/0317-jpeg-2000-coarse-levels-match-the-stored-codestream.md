# 0317. JPEG 2000 coarse levels match the stored codestream, not OpenSlide's resampled read

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-055 (JPEG 2000 coarse level differences from OpenSlide). Builds on [ADR 0111](0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md) (JPEG 2000 in the decode workers), [ADR 0310](0310-converted-jpeg-2000-slides-are-lossless-and-keep-the-source-levels.md) (converted JPEG 2000 slides are lossless and keep the source levels) and [ADR 0316](0316-jpeg-2000-slides-stay-native.md) (JPEG 2000 slides stay native).

## Context

VIEW-011 (SVS JPEG 2000 through OpenJPEG WASM) found single tiles at levels 1 and 2 of `JP2K-33003-1.svs` and `JP2K-33003-2.svs` up to 47 grey levels from OpenSlide, while level 0 was within 0.5. INGEST-015 (conversion fallback worker) then found that OpenSlide divides a level 0 location by the exact downsample, 4.0004 or 8.0018 on these slides, so every coarse read away from (0, 0) starts at a fraction of a pixel and is resampled. It decoded those levels from their codestreams instead, with OpenSlide's own YCbCr tables. ADR 0316 keeps JPEG 2000 slides native, so the browser decodes the same codestreams.

The browser reader and the INGEST-009 (seams and correctness check) reference had to agree on what a coarse level is. The reference windows were OpenSlide reads, so on coarse JPEG 2000 levels they were resampled.

## Options considered

1. The browser matches the stored codestream, and the server reference decodes the codestream on coarse JPEG 2000 levels.
2. The browser matches OpenSlide by resampling each coarse level by the fractional downsample.
3. Leave both as they are and keep the mean error check only.

## Decision

Option 1. The [result](../results/2026-11-15-jpeg-2000-coarse-level-differences.md) shows the difference follows where OpenSlide is asked to read and not the decoder. The same codestream decode is 0 from OpenSlide at (0, 0) and 43 to 46 from it at the whole-downsample locations VIEW-011 used. The browser reader is within 3 grey levels of the codestream at every level of both slides, and its level table equals the TIFF pages.

- The codestream is what the scanner wrote. A resampled read is a property of one reader's location arithmetic, and it is not even stable inside OpenSlide, since it changes with the location and with the 4096 px pieces a read is split into.
- The converted store of ADR 0310 already takes these levels from the codestream. With option 1 the native browser view, the converted store and the reference are the same pixels.
- Option 2 would blur every coarse tile by a sub-pixel shift for no gain in placement. Placing a level at its whole downsample instead of the exact one moves its far edge by at most 0.6 of that level's pixel on these slides (2041 × 0.0044 / 16 on level 2 of `JP2K-33003-2.svs`), and nothing at the origin.
- Option 3 cannot tell the two references apart. The browser was a mean of 0.98 from the old OpenSlide window, under the 1.0 limit, and 14 at its largest.

Built with it:

- `reference_tiles.py` cuts a window on an Aperio JPEG 2000 level whose OpenSlide downsample is not whole from the stored codestream, decoding only the tiles the window touches, through `aperio_jpeg2000_window` in `source_levels.py`. Every other level and format keeps its OpenSlide or tifffile read.
- Aperio JPEG 2000 slides get a reference window on every level, not the usual two, and `JP2K-33003-2.svs` joins the reference fixtures.
- The reader check reports the largest difference of each window as well as the mean. The JPEG 2000 slides are held to a largest difference of 3 and a mean of 0.5.

## Consequences

- The browser keeps reading coarse JPEG 2000 levels as stored, with no change to the decoder or the level table.
- A residual of 1 to 3 grey levels remains at every level, including level 0, because the OpenJPEG WASM build converts YCbCr with its own arithmetic and not OpenSlide's fixed point table. It is under the agreement limit and is not changed here.
- Aperio JPEG slides such as `CMU-1.svs` have the same fractional downsamples (4.0001 and 16.0005), so their coarse reference windows are still OpenSlide's resampled reads. They pass the mean check. TODO a follow-up task could cut them from the stored JPEG tiles the same way and bound their largest difference.
- Window placement is unchanged. Coarse level pixel x still covers level 0 from x times the whole downsample, as before, which matches how the viewer places levels.
