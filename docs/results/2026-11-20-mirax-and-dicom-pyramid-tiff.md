# Result: MIRAX and DICOM gallery zips converted to a lossless pyramid TIFF

- Date: 2026-11-20
- Backlog: VIEW-081 (slides that arrive as a MIRAX or DICOM zip open in the viewer). Decision in [ADR 0408](../adr/0408-mirax-and-dicom-slides-are-served-as-a-lossless-pyramid-tiff-made-at-ingest.md) (MIRAX and DICOM slides are served as a lossless pyramid TIFF made at ingest)
- Kind: measurement
- Environment: the owner's MacBook (Apple M4), macOS 15, Python 3.14 through `uv`, other agents running. Times are one run each
- Data: the public OpenSlide test fixtures `CMU-1-Saved-1_16.zip` and `CMU-1-JP2K-33005-v2.zip` from the fixture cache. No PHI

## Question

How large, how slow and how memory hungry is converting each gallery zip to a deflate BigTIFF that keeps every source level, and does the browser open the result?

## Method

1. `uv run python -m parfocal_ingest.pyramid_tiff ZIP TARGET` under `/usr/bin/time -l`, once per fixture.
2. Read the TIFF back with `identify` and `read_pyramid`, and cut a 64 px crop with `PatchService`.
3. `test_pyramid_tiff.py` compares a 512 px window in the middle of every MIRAX level with OpenSlide.
4. `apps/web/e2e/converted-zip-slides.spec.ts` opens both converted folders in the app on the fake API and counts the colours drawn.

## Results

| Fixture | Source | Levels | Level 0 | TIFF | Ratio | Time | Peak resident memory |
|---|---|---|---|---|---|---|---|
| CMU-1-Saved-1_16.zip (MIRAX) | 3,754,715 bytes | 6, downsamples 1 to 32 | 7436 x 15494 | 18,725,365 bytes | 5.0 | 4.1 s | 675 MB |
| CMU-1-JP2K-33005-v2.zip (DICOM) | 127,346,479 bytes | 3, downsamples 1, 4, 16 | 46000 x 32893 | 1,075,404,540 bytes | 8.4 | 108 s | 3.6 GB |

- Both TIFFs identify as `generic-tiff`, list the same level sizes as the source, keep the source microns per pixel (3.717 and 0.499) and give a crop.
- Every compared MIRAX window equals OpenSlide's pixels exactly.
- Both slides reached the ready state and drew in Chrome. The MIRAX test took 8 s and the DICOM test 2.0 minutes, almost all of it the conversion.
- The memory figure counts pages of the memory-mapped level file, so it rises with level 0 size.

## Conclusion

The conversion is quick enough to run once per fixture, and both slides open with no new browser code. Lossless storage is 5 to 8.4 times the archive. For the two gallery slides that is about 1.1 GB, about $0.02 a month in R2.
