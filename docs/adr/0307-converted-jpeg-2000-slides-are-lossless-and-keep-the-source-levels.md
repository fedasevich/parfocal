# 0307. Converted JPEG 2000 slides are lossless zstd, and each store level is the source's own level where it has one

- Date: 2026-11-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: INGEST-015 (conversion fallback worker). Applies decision 104 (how close a converted JPEG 2000 slide stays to its source), option A, with Fable's two additions. Amends [ADR 0306](0306-conversion-triggers-and-the-ome-zarr-target.md) (conversion triggers and the OME-Zarr target).

## Context

ADR 0306 wrote 8-bit RGB as JPEG q90 chunks and built every level below 0 as a 2 by 2 mean of the level above. On the trigger fixture `JP2K-33003-1.svs` that put the most textured tissue 5 to 6 grey levels from the source, above the 1.0 of INGEST-009 (seams and correctness check). The owner chose lossless chunks so that converted slides look correct. Fable added that the INGEST-009 check becomes exact equality for converted slides, and that each level comes from the source's own level where it has one.

The source's coarse JPEG 2000 levels cannot come from OpenSlide. It resamples every read whose location is not a whole pixel at the level, and at the slide's downsample of 4.0004 that is every read not at (0, 0), as well as every 4096 px piece it splits a large read into.

## Options considered

1. Lossless zstd chunks, with coarse JPEG 2000 levels decoded tile by tile and converted with OpenSlide's YCbCr tables.
2. Lossless zstd, but every level below 0 a fresh mean. Exact against level 0, but not the pixels the scanner wrote at its own levels.
3. Keep JPEG chunks at a higher quality. Smaller, but never exact.
4. Read coarse levels with OpenSlide from (0, 0) in one call. Exact only up to 4096 px, and it needs the whole level in memory.

## Decision

- Option 1, at zstd level 3, which was within 1% of every lossless codec the browser decodes ([result](../results/2026-11-14-lossless-jpeg-2000-conversion.md)). `TRIGGER_CHUNKS` in `parfocal_ingest.conversion` maps the JPEG 2000 trigger to zstd, so `convert` writes uint8 RGB as one zstd chunk of `[3, 512, 512]` with fill 255 and the RGB `omero` channels the browser reads as brightfield. JPEG chunks remain only for the fixture tool, which no trigger uses.
- `level_plan` lists the store levels at downsamples 1, 2, 4 and on. A level comes from the source when the source has that downsample, and otherwise it is the 2 by 2 mean of the store's level above, as before. The ladder of INGEST-006 (pyramid and level validation) is unchanged.
- `parfocal_ingest.source_levels` reads a source level exactly. tifffile reads its own levels. OpenSlide reads a level in blocks only when its downsample is a whole number. An Aperio JPEG 2000 level (33003 or 33005) is decoded tile by tile by Pillow inside a JP2 wrapper that declares sRGB, and 33003 then goes through the libjpeg fixed point YCbCr tables that OpenSlide uses. Any other level that cannot be read exactly is made as a fresh mean.
- The INGEST-009 check for a lossless store is exact equality at every level, against the source reader for levels from the source and against the rounded mean of the level above for the rest.

## Consequences

- The trigger fixture's store equals its source at every compared pixel, and the synthetics do too ([result](../results/2026-11-14-lossless-jpeg-2000-conversion.md)).
- The store is 11.6 times the source, 741 MB against 64 MB, and JPEG q90 was 2.9 times. At that ratio, 100 converted slides of 1 GB would cost about $17 a month in R2. Measured alternatives do not change that: zstd 19 is 1.0% smaller, blosc bit shuffle is larger, no chunk is exactly glass, and lossless JPEG 2000 and WebP, which the browser cannot decode as Zarr chunks today, reach about 9.5 and 9.1 times. zstd level 3 stays. A trigger that fires on large slides must weigh this storage against native reading.
- Regenerating the two committed converted stores changed level 1 of each, now taken from the source. In `synthetic-jpeg-converted.ome.zarr` it moved by 0.905 mean and 41 at most, and in `synthetic-channels-uint16-converted.ome.zarr` by 0.143 mean and 1 at most. The Viv goldens of `viv-ome-zarr.spec.ts` still pass unchanged.
- A zero-length or undecodable JPEG 2000 tile makes its level a fresh mean, not a failed conversion.
- No lossless RGB store is committed or drawn in Viv yet. The browser treats a uint8, three channel store with red, green and blue `omero` colours as brightfield whatever its codec, but that is not yet checked by a golden.
