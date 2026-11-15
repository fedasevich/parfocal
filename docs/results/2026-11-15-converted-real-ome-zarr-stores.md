# Result: a real slide converted to OME-Zarr 0.5 reads within 3 grey levels with JPEG chunks and within 1 with zstd chunks

- Date: 2026-11-15
- Backlog: VIEW-017 (OME-Zarr v0.4 and v0.5 sharded with JPEG and lossless codecs)
- Kind: check
- Commit: 42b074f9 plus the VIEW-017 change that adds `zarr-converted.test.ts`
- Environment: MacBook with Apple M4, Node v26.13.1, Python 3.14, Playwright Chromium with SwiftShader, loopback servers, shared with four other agents
- Data: the public OpenSlide test slide `CMU-1-Small-Region.svs` (2220 × 2967, JPEG tiles, fixture group `small`, no PHI), the committed converted synthetic stores, and IDR image 6001240 as OME-Zarr 0.4 and as sharded 0.5

## Question

Does the browser reader show the right pixels for stores the INGEST-015 (conversion fallback worker) converter writes from a real slide, with its JPEG chunks and with its lossless zstd chunks?

## Method

1. `uv run --package parfocal-ingest python packages/test-fixtures/scripts/make_converted.py` converts the cached slide twice with `write_store`, once with the default chunks (JPEG q90, 4:4:4) and once with zstd forced, into `converted/` inside the fixture cache. The stores are 2,686,121 and 10,324,652 bytes in 49 files each, too large to commit, so they are built from the cached slide like the other derived data.
2. `node --test packages/viewer-engine/test/pixel-source/zarr-converted.test.ts` runs the conformance suite on both stores, compares three 512 px windows of level 0 with the source slide read by the TIFF reader, compares level 0 to 3 of the JPEG store with the zstd store on their first 512 × 512, and checks that the coarsest zstd level is the exact 2 by 2 mean of the level above, rounded half to even. It skips when the slide or the stores are missing.
3. `pnpm --filter @parfocal/viewer-engine exec playwright test zarr-jpeg --workers=1` opens the real JPEG store and the committed converted synthetic store in the page and in a decode worker.
4. `pnpm --filter @parfocal/golden-images exec playwright test viv-ome-zarr --workers=1` draws both real stores through Viv at fit. The two new goldens were written with `GOLDEN_UPDATE=1` and compared with each other by number.
5. `PARFOCAL_IDR=1 node --test packages/viewer-engine/test/pixel-source/zarr-idr.test.ts` read the two IDR stores again.

## Results

| Check | Result |
| --- | --- |
| Store levels, both chunk kinds | 2220 × 2967, 1110 × 1483, 555 × 741, 277 × 370, level 0 from the source and the rest fresh 2 by 2 means |
| Tests in `zarr-converted.test.ts` | 23 pass, 0 fail |
| JPEG store against the slide, level 0 windows at 0,0, 1024,1536 and 1708,2455 | mean absolute error 0.6283, 1.6129, 0.4726 |
| zstd store against the slide, same windows | mean absolute error 0.0017, 0.0613, 0.0055, largest difference 1 |
| JPEG store against the zstd store, levels 0 to 3 | mean absolute error 0.6282, 1.3641, 2.3994, 2.5620 |
| Coarsest zstd level against the exact mean of level 2 | equal at every sample |
| Browser decoder on the real and the synthetic converted JPEG stores, page and worker | native, agreed, no fallbacks |
| Viv goldens, 800 × 600, JPEG store against zstd store | mean channel difference R 1.006, G 0.717, B 1.001, 18.5% of the zstd frame stained |
| Viv goldens of `viv-ome-zarr.spec.ts` | 6 of 6 pass |
| IDR test | 1 pass |

## Interpretation

The zstd store differs from the slide by at most 1 grey level because the converter decodes the source JPEG tiles with libjpeg in Python and the test decodes them with the browser reader's own decoder. INGEST-015 already showed the store equal to the source in Python, so this is decoder rounding, not a store error. The JPEG store's error grows toward the coarse levels, where each level is re-encoded from a smaller mean and the edges of tissue take a larger share of the pixels. The coarsest level at 2.56 is close to the limit of 3. That reading of the growth is an assumption and was not located pixel by pixel.

## Limits

One real slide, brightfield RGB JPEG only. The converter writes OME-Zarr 0.5 unsharded, so 0.4 and sharded 0.5 still rest on the generated stores and the IDR samples, not on converted ones. No converted JPEG 2000 slide was read in the browser, because the only real trigger slide, `JP2K-33003-1.svs`, converts to 741 MB, and `synthetic-jp2k-33003.tiff` is not readable as a pyramid by the converter. The stores are rebuilt by hand, so a converter change shows up here only after the script runs again. TODO: the fixtures README should list the `converted/` cache and the command.
