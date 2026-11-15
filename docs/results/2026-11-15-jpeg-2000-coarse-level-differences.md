# Result: the JPEG 2000 coarse level differences came from OpenSlide's resampled reference, and the browser reader matches the stored codestream within 3 grey levels at every level

- Date: 2026-11-15
- Backlog: VIEW-055 (JPEG 2000 coarse level differences from OpenSlide)
- Kind: check
- Commit: the VIEW-055 commit on top of 5e5a5286
- Environment: MacBook with Apple M4, Node v26.9.0, Python 3.14 with openslide-bin 4, Pillow 13 and tifffile, shared with four other agents
- Data: the public OpenSlide test slides `JP2K-33003-1.svs` (levels at downsample 1, 4.000375 and 8.001790) and `JP2K-33003-2.svs` (1, 4.000184 and 16.004354), Aperio JPEG 2000 compression 33003. No PHI

## Question

VIEW-011 (SVS JPEG 2000 through OpenJPEG WASM) found one tile at each of levels 1 and 2 up to 47 grey levels from OpenSlide while level 0 was within 0.5. Is the cause the reference, the level table or the decoder?

## Method

1. Each tile VIEW-011 named was decoded from its stored codestream by `jpeg2000_tile` in `workers/ingest/src/parfocal_ingest/source_levels.py`, which is OpenJPEG through Pillow plus the libjpeg fixed point YCbCr tables OpenSlide uses (INGEST-015, the conversion fallback worker). Only the tiles a window touches were read, never a whole level.
2. The same tiles were read with OpenSlide's `read_region` at two level 0 locations, the tile origin times the exact downsample rounded, and the tile origin times the whole downsample, which is what VIEW-011 did.
3. The browser reader (`openTiffSource` with the OpenJPEG WASM decoder) read the same tiles in Node, and its level table was printed.
4. After the fix, `READER_CHECK_MEASURE=1 node --test test/pixel-source/reader-check.test.ts` in `packages/viewer-engine` printed the mean and largest difference for each reference window, once against the new windows and once with the old OpenSlide window of level 1 swapped back in.

## Results

Largest and mean absolute difference over all samples of a 256 px tile.

| Slide | Level, tile | OpenSlide at rounded exact location | OpenSlide at whole downsample | Browser reader |
|---|---|---|---|---|
| JP2K-33003-1.svs | 0, 40,12 | 0 (mean 0.000) | 0 (mean 0.000) | 2 (mean 0.484) |
| JP2K-33003-1.svs | 1, 8,5 | 16 (mean 0.391) | 44 (mean 0.886) | 2 (mean 0.411) |
| JP2K-33003-1.svs | 2, 3,2 | 10 (mean 0.146) | 46 (mean 0.751) | 3 (mean 0.384) |
| JP2K-33003-2.svs | 0, 40,12 | 0 (mean 0.000) | 0 (mean 0.000) | 1 (mean 0.419) |
| JP2K-33003-2.svs | 1, 8,5 | 7 (mean 0.093) | 7 (mean 0.093) | 1 (mean 0.413) |
| JP2K-33003-2.svs | 2, 3,2 | 5 (mean 0.079) | 43 (mean 0.764) | 2 (mean 0.355) |

All three columns are compared with the codestream decode of step 1.

- The browser's level table equals the TIFF pages: 15374 × 17497, 3843 × 4374 and 1921 × 2187 for the first slide, 32671 × 47076, 8167 × 11769 and 2041 × 2942 for the second, with downsamples 1, 4 and 8, and 1, 4 and 16.
- OpenSlide read at (0, 0) of every level of both slides equals the codestream decode at every sample of a 512 × 512 window.
- The INGEST-009 (seams and correctness check) reference windows, now cut from the codestream on coarse JPEG 2000 levels, against the browser reader:

| Slide | Level 0 | Level 1 | Level 2 |
|---|---|---|---|
| JP2K-33003-1.svs | mean 0.455, largest 1 | mean 0.423, largest 2 | mean 0.423, largest 2 |
| JP2K-33003-2.svs | mean 0.463, largest 2 | mean 0.464, largest 2 | mean 0.422, largest 2 |

- With the old OpenSlide window of level 1 of `JP2K-33003-1.svs` swapped back in, the browser was a mean of 0.980 and a largest of 14 from it. That mean passed the old check of 1.0, so a mean alone could not tell the two references apart. The old and new windows differ by a mean of 0.761 and a largest of 13.
- `CMU-1.svs` (Aperio JPEG, not JPEG 2000) has downsamples 4.000122 and 16.000486, and `CMU-1-JP2K-33005.svs` has 4.000061 and 16.003163.

## Conclusion

The cause is the reference. OpenSlide maps a level 0 location to a coarse level by dividing by the exact downsample, so at 4.0004 or 8.0018 no location away from (0, 0) lands on a whole pixel, and OpenSlide resamples the tile. The spike follows where OpenSlide was asked to read, not the decoder: the same codestream decode is 0 from OpenSlide at (0, 0) and 43 to 46 from it at the whole-downsample location VIEW-011 used. The level table is right, and the decoder is as close at levels 1 and 2 as at level 0. The remaining 1 to 3 grey levels at every level are the colour conversion inside the OpenJPEG WASM build, which is not OpenSlide's fixed point table. [ADR 0317](../adr/0317-jpeg-2000-coarse-levels-match-the-stored-codestream.md) records that the browser's coarse levels match the stored codestream and that the reference now does too.

## Pinned by

- `workers/ingest/tests/test_reference_tiles.py`: OpenSlide at each level's origin equals the codestream decode exactly, OpenSlide away from the origin is at least 5 grey levels off on the four tiles above while the reference window there equals the codestream exactly, and the committed windows (now three levels for each JPEG 2000 slide, with `JP2K-33003-2.svs` added) still match the server reader.
- `packages/viewer-engine/test/pixel-source/reader-check.test.ts`: on both slides every level agrees with the reference within a mean of 0.5 and a largest difference of 3, which the old level 1 window fails at 14.

## Limits

Two slides, both compression 33003, one tile per level, one run. The colour residual of up to 3 was not traced inside the WASM build. Aperio JPEG slides have the same fractional downsamples, so their coarse INGEST-009 reference windows are still OpenSlide's resampled reads. Their mean check passes, but they were not measured here.
