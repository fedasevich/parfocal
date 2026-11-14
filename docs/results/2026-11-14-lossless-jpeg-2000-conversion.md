# Result: a lossless converted JPEG 2000 slide equals its source at every level and is 11.6 times the source size

- Date: 2026-11-14
- Backlog: INGEST-015 (conversion fallback worker)
- Kind: baseline
- Commit: the INGEST-015 commit that applies decision 104 (lossless chunks for converted JPEG 2000 slides)
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
- OpenSlide cannot be the reader for those levels. It maps a location to a level as location divided by downsample, and at 4.0004 that leaves a fraction of a pixel, so every read not at (0, 0) is resampled, by up to 37 grey levels at the offsets tried. It also splits a read into pieces of 4096 px, so even a read from (0, 0) is resampled past row 4096 (up to 21 grey levels). The test compares those levels only inside the first 4096 × 4096, which covers both levels 2 and 3 of this slide whole.

## Conclusion

Decision 104 holds as built: the converted slide is the source, sample for sample, at every level the source has, and every other level is an exact mean of the one above it. The cost is size. At 11.6 times the source, one converted JPEG 2000 slide of this kind costs about $0.011 a month in R2 at $0.015 per GB past the free 10 GB, so 100 slides of 1 GB each would add about 1,160 GB and about $17 a month, more than half of the $30 budget. The times are inflated by the shared machine and are not a Modal estimate.

## Limits

One real slide, one run each, on a loaded laptop. Zstd level 3 only, with no byte shuffle, delta filter or other lossless codec tried, and glass chunks are stored. The lossless RGB store was not drawn in Viv in this run, and the regenerated committed stores were not checked against their Viv goldens. Only Aperio JPEG 2000 33003 was decoded. The 33005 (RGB) path is the same code without the YCbCr step and has no fixture.
