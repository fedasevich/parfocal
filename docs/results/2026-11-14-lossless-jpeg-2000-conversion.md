# Result: a lossless converted JPEG 2000 slide equals its source at every level and is 11.6 times the source size

- Date: 2026-11-14
- Backlog: INGEST-015 (conversion fallback worker)
- Kind: baseline
- Commit: 62ec1b30 (the INGEST-015 commit that applies decision 104, lossless chunks for converted JPEG 2000 slides)
- Environment: MacBook with Apple M4, Python 3.14 with openslide-bin 4 and Pillow 13, shared with about ten other agents (load average 31 to 43 during the runs)
- Data: the committed synthetic slides and the public OpenSlide test slide `JP2K-33003-1.svs` (15374 × 17497, Aperio JPEG 2000 33003, levels at downsample 1, 4 and 8, 63,847,265 bytes, fixture group `formats`). No PHI

## Question

With lossless zstd chunks and each level taken from the source's own level where it has one, is a converted JPEG 2000 slide exactly equal to its source, and how large and slow is the store?

## Method

`test_a_lossless_store_equals_the_source_at_every_level` in `workers/ingest/tests/test_conversion.py` converts the trigger fixture through `convert`, and the two brightfield synthetics and the two 16-bit synthetics with zstd forced. It walks every store level in strips of 512 rows. A level taken from the source is compared with the source reader at that level: tifffile for OME-TIFF, OpenSlide at integer locations where the level's downsample is a whole number, and for the JPEG 2000 levels an OpenSlide read anchored at (0, 0). A level the source lacks is compared with the 2 by 2 mean of the store's finer level, rounded half to even. The size and time come from one `convert` run and one forced JPEG q90 run on the same slide, measured with `time.perf_counter` and the summed file sizes of the store.

## Results

Every compared pixel is equal, maximum difference 0, at every level of all five stores.

| Store of JP2K-33003-1.svs | Time | Bytes | Times the source | Level 0 | Level 1 | Levels 2 to 6 |
|---|---|---|---|---|---|---|
| Lossless zstd level 3 | 150.7 s | 740,948,884 | 11.6 | 574,334,122 | 134,396,138 | 32,215,002 |
| JPEG q90, for comparison | 52.0 s | 187,261,316 | 2.9 | 151,825,718 | 28,473,988 | 6,957,988 |

- The store has 7 levels at downsamples 1 to 64. Levels 0, 2 and 3 come from the source, and levels 1, 4, 5 and 6 are fresh 2 by 2 means.
- Both stores have 1,482 files. Glass chunks are written, not left absent.
- The JPEG 2000 levels at downsample 4 and 8 are decoded tile by tile: Pillow (OpenJPEG) decodes each codestream inside a JP2 wrapper that declares sRGB, so the YCbCr components come out unconverted, and the converter applies the libjpeg fixed point tables that OpenSlide uses. On a 4096 × 4096 OpenSlide read from (0, 0) this is equal at every pixel. With Pillow's own YCbCr conversion it was 1 grey level lower on 73% of the pixels of a tile, and an earlier table with rounded floating point factors was 1 off on a few pixels.
- OpenSlide cannot be the reader for those levels. It maps a location to a level as location divided by downsample, and at 4.0004 that leaves a fraction of a pixel, so every read not at (0, 0) is resampled, by up to 37 grey levels at the offsets tried. It also splits a read into pieces of 4096 px, so even a read from (0, 0) is resampled past row 4096 (up to 21 grey levels). The test compares those levels only inside the first 4096 × 4096, which covers store level 3 (1921 × 2187) whole and store level 2 (3843 × 4374) on its first 4096 of 4374 rows. The last 278 rows of level 2 come from the same tile decoder but have no exact OpenSlide reference.

## Lossless options compared

A second run converted the slide again (24.8 s, with the machine less loaded) and re-encoded each of the 1,474 chunks of its store with each option, checking that every option decodes back to the same samples. Encode time is the sum over all chunks. Decode time is the mean over every tenth chunk, in Python on this Mac, which only stands in for the browser. PNG and WebP were measured on every fiftieth chunk (30 chunks) and are given relative to zstd 3 on the same chunks. The zarrita 0.7.5 registry that `packages/viewer-engine` uses decodes zstd, blosc (with byte or bit shuffle), gzip, zlib, lz4 and transpose, plus the JPEG chunk codec of ADR 0305. It has no delta filter, and the viewer's OpenJPEG decoder is registered for TIFF tiles only, not as a Zarr codec.

| Option | Decodes in the browser today | Store bytes | Times the source | Encode | Decode per chunk |
|---|---|---|---|---|---|
| zstd level 3 (as built) | Yes | 740,940,463 | 11.60 | 4.3 s | 1.0 ms |
| zstd level 9 | Yes | 740,375,790 | 11.60 | 18.4 s | 1.7 ms |
| zstd level 19 | Yes | 733,209,547 | 11.48 | 195.2 s | 1.3 ms |
| blosc zstd 5, bit shuffle | Yes | 757,836,084 | 11.87 | 5.9 s | 1.0 ms |
| blosc zstd 9, bit shuffle | Yes | 746,413,713 | 11.69 | 178.2 s | 1.4 ms |
| JPEG 2000 lossless (5/3 wavelet, RCT) | No, needs a Zarr codec over the existing OpenJPEG decoder | 605,241,192 | 9.48 | 135.9 s | 87.7 ms |
| PNG level 9, sample | No | 0.985 of zstd 3 | about 11.4 | 2.1 s for 30 chunks | 7.4 ms |
| WebP lossless, method 4, sample | No | 0.784 of zstd 3 | about 9.1 | 26.6 s for 30 chunks | 8.2 ms |

- No chunk of the store is all 255, so leaving glass out costs nothing only if a near white chunk may be dropped, which would break the maximum difference of 0. Exact absence saves 0 bytes on this slide.
- Byte shuffle does nothing on 8-bit samples, and bit shuffle makes the store larger.
- The whole range of lossless options lands between 9 and 12 times the source. The source is a lossy JPEG 2000 at about 12.6 to 1 of the raw 807 MB level 0, and its decoded pixels carry that codec's noise, which no lossless coder removes.
- The converter stays on zstd level 3. Level 19 is 1.0% smaller for 45 times the encode time, and the two smaller options need a new browser codec and, for JPEG 2000, about 88 times the decode time per chunk.

## Conclusion

Decision 104 holds as built: wherever an exact reference exists, the converted slide equals the source sample for sample at every level the source has, and every other level is an exact mean of the one above it. The cost is size. At 11.6 times the source, one converted JPEG 2000 slide of this kind costs about $0.011 a month in R2 at $0.015 per GB past the free 10 GB, so 100 slides of 1 GB each would add about 1,160 GB and about $17 a month, more than half of the $30 budget. The times are inflated by the shared machine and are not a Modal estimate. No lossless codec the browser decodes today shrinks the store by more than 1%, and the best lossless codec measured would still leave it about 9 times the source. Keeping such a slide small means reading it natively, which is what INGEST-014 (JPEG 2000 performance decision) measures, not a better lossless codec.

The Viv goldens of `render/viv-ome-zarr.spec.ts` pass on the regenerated committed stores with no golden rewritten (4 of 4, SwiftShader, one worker).

## Limits

One real slide, one run each, on a loaded laptop. Zstd level 3 only, with no byte shuffle, delta filter or other lossless codec tried, and glass chunks are stored. The lossless RGB store was not drawn in Viv in this run. Decode times are Python on a Mac, not the browser, and PNG and WebP were measured on a 30 chunk sample. Only Aperio JPEG 2000 33003 was decoded. The 33005 (RGB) path is the same code without the YCbCr step and has no fixture.
