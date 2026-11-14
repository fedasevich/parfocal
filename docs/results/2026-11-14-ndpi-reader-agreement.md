# Result: NDPI reader agreement on real slides

- Date: 2026-11-14
- Backlog: VIEW-013 (NDPI including above 4 GB)
- Kind: baseline
- Commit: 28438337
- Environment: MacBook with Apple M4, macOS 15.8.1, Node v26.13.0, Playwright 1.64.0 Chromium with SwiftShader, local range server on loopback
- Data: `CMU-1.ndpi` (fixture group `formats`) and `Hamamatsu-1.ndpi` (6.9 GB, fixture group `huge`), both OpenSlide test data with no PHI

## Question

Does the browser NDPI reader show the same pixels as the server reader (OpenSlide) on real slides, including one above 4 GB, and can the browser's own JPEG decoder be trusted on NDPI tiles? The agreement limit is the reader check's own threshold, and the POC number for a wrong colour path is a mean absolute error of 47.69 on `CMU-1.svs`.

## Method

1. Reference windows of 256 x 64 pixels were written by `python -m parfocal_ingest.reference_tiles` (OpenSlide) into `packages/test-fixtures/reference-tiles/`.
2. `READER_CHECK_MEASURE=1 node --test packages/viewer-engine/test/pixel-source/reader-check.test.ts` printed the mean absolute error per window with the script decoder.
3. `node --test packages/viewer-engine/test/pixel-source/ndpi-real.test.ts` opened both slides, recorded the highest byte range start per level and compared a slide index open with a directory walk open. With `NDPI_SIDECAR_DIR` set it also read the sidecars the ingest worker writes.
4. `pnpm --filter @parfocal/viewer-engine exec playwright test browser/native-jpeg.spec.ts -g "CMU-1.ndpi"` measured the browser decoder against the script decoder, twice.
5. `pnpm --filter @parfocal/golden-images exec playwright test render/viv-ndpi.spec.ts` drew the two Viv goldens.

## Results

Mean absolute error against OpenSlide, in grey levels of 255.

| Slide | Level | Downsample | Window origin | Mean absolute error | Finding |
| --- | --- | --- | --- | --- | --- |
| CMU-1.ndpi | 0 | 1 | 34688, 19040 | 0.124 | none |
| CMU-1.ndpi | 1 | 4 | 8576, 4736 | 0.085 | none |
| Hamamatsu-1.ndpi | 0 | 1 | 30592, 50656 | 0.157 | none |
| Hamamatsu-1.ndpi | 1 | 2 | 78592, 42208 | 0.084 | none |

Level sizes and scale read by the browser reader. They equal what OpenSlide reports for the stored levels.

| Slide | Levels (width x height at downsample) | Microns per pixel x, y |
| --- | --- | --- |
| CMU-1.ndpi | 51200 x 38144 at 1, 12800 x 9536 at 4, 3200 x 2384 at 16, 800 x 596 at 64 | 0.45641, 0.45506 |
| Hamamatsu-1.ndpi | 188160 x 101376 at 1, 94080 x 50688 at 2, 47040 x 25344 at 4, 23520 x 12672 at 8, 11760 x 6336 at 16, 5880 x 3168 at 32 | 0.23026, 0.23030 |

Highest byte range start while reading a window in the last rows of each level of `Hamamatsu-1.ndpi`. 4 GB is 4294967296.

| Level | Highest range start |
| --- | --- |
| 0 | 4803556490 |
| 1 | 6286016608 |
| 2 | 6738260300 |
| 3 | 6861421045 |
| 4 | 6892807530 |
| 5 | 6900576975 |

Slide index.

| Slide | Requests to open by directory walk | Requests to open from the index | Ingest sidecar size | Restart tables it replaces |
| --- | --- | --- | --- | --- |
| CMU-1.ndpi | 12 | 1 | 1,282,597 bytes | 625,800 bytes |
| Hamamatsu-1.ndpi | 17 | 0 | 10,902,475 bytes | 9,779,616 bytes |

The one request on `CMU-1.ndpi` reads the frame header of its smallest level, which is stored without restart intervals. Every level of `Hamamatsu-1.ndpi` has them, so its index open needs no request.

Pixels read from the index were identical to pixels read after a directory walk on the tissue window and on the bottom right window of every level, for both the index built in the test and the ingest sidecar.

Browser decoder on `CMU-1.ndpi`, window 25600, 18944 to 27648, 20992 at level 0.

| Measure | Run 1 | Run 2 |
| --- | --- | --- |
| Decoder chosen in the page and in the worker | native, agreed | native, agreed |
| Page probe mean absolute error | 0.034 | not recorded |
| Worker probe mean absolute error | 0.058 | not recorded |
| Window mean absolute error, native against script | 0.030 | not recorded |
| Repeat read, native | 27.5 ms | 25.0 ms |
| Repeat read, script | 27.6 ms | 26.9 ms |

## Interpretation

The reader agrees with OpenSlide within 0.16 grey levels on both slides, far below the 47.69 a wrong colour path gives, so the YCbCr conversion and the tile placement are right. Every level of the 6.9 GB slide was read from offsets above 4 GB. The browser's JPEG decoder agrees with the script decoder on NDPI, unlike on Aperio SVS, so NDPI decodes natively. The repeat read times measure the reader's decoded unit cache and not the decoders, so the speed assertion is skipped for NDPI. For NDPI the index saves the directory walk and the restart table reads, but the sidecar is about as large as the tables it replaces.

## Follow-ups

- The ingest sidecar's offsets above 4 GB were correct on `Hamamatsu-1.ndpi`, which ADR 0153 (the sidecar tile index) had only checked below 4 GB.
- TODO: a 10.9 MB JSON index for a 6.9 GB NDPI may be worth a binary or range-read form. No task added yet.
- TODO: a cold decode timing for NDPI, native against script, has not been measured.
