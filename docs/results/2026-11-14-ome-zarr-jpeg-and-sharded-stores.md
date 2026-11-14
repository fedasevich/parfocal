# Result: OME-Zarr JPEG chunks, sharded stores and the public IDR samples

- Date: 2026-11-14
- Backlog: VIEW-017 (OME-Zarr v0.4 and v0.5 sharded with JPEG and lossless codecs)
- Kind: baseline
- Commit: f590958d
- Environment: MacBook with Apple M4, Node v26.13.1, Playwright 1.64.0 Chromium with SwiftShader, local range server on loopback, and the public IDR object store over the home network for step 2
- Data: the committed stores `synthetic-jpeg.ome.zarr` and `synthetic-jpeg-sharded.ome.zarr`, and IDR image 6001240 (public, no PHI) as OME-Zarr 0.4 at `https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr` and as sharded 0.5 at `https://uk1s3.embassy.ebi.ac.uk/idr/share/ome2024-ngff-challenge/0.0.5/6001240.zarr`

## Question

Does the browser reader show the right pixels for OME-Zarr 0.4 and sharded 0.5 with JPEG and lossless chunks, and does it read public IDR stores it did not write? The limit for JPEG is the native agreement threshold of 3 grey levels.

## Method

1. `node --test packages/viewer-engine/test/pixel-source/zarr-codecs.test.ts` ran the conformance suite on both JPEG stores and four generated lossless stores, and compared every level of the JPEG stores with `synthetic-zlib.ome.tiff`, the lossless file of the same picture.
2. `PARFOCAL_IDR=1 node --test packages/viewer-engine/test/pixel-source/zarr-idr.test.ts` read tile 0, 0 of the finest and the coarsest level of both IDR stores and compared them.
3. `pnpm --filter @parfocal/viewer-engine exec playwright test zarr-jpeg` opened both JPEG stores in the page and in a decode worker.
4. `pnpm --filter @parfocal/golden-images exec playwright test viv-ome-zarr` drew both stores through Viv. A script compared the two new goldens with the existing golden `viv-synthetic-jpeg-tiff-fit` of the same picture.
5. `pytest workers/ingest/tests/test_zarr_index.py` indexed sharded stores with missing inner chunks.

## Results

| Check | Result |
| --- | --- |
| Tests in `zarr-codecs.test.ts` | 71 pass, 0 fail |
| JPEG stores against the lossless OME-TIFF, every level | mean absolute error above 0 and within 3 |
| Lossless stores (zstd in shards at 16 bits, gzip in shards, zstd unsharded in 0.4 and 0.5) | every sample equal to what was written |
| IDR 0.4 store, blosc lz4 chunks, 2 channels of uint16 | levels 271 x 275, 135 x 137, 67 x 68, 12 requests |
| IDR 0.5 store, shards of blosc zstd chunks with a crc32c index | same levels, 12 requests |
| IDR plane sums, finest then coarsest, both stores | 781649, 2224491, 47971, 136497 in each |
| Browser decoder on both JPEG stores, page and worker | native, agreed, no fallbacks |
| Viv goldens against the JPEG TIFF golden, 800 x 600 | mean channel difference 0.3427, largest 36, for both |
| Ingest index tests | 10 pass |

## Interpretation

The two IDR stores hold the same image in the two layouts, and the reader returns identical samples from both, so sharding, blosc and the `ome` nesting of 0.5 are read correctly on stores made by other tools. The Viv picture of the Zarr stores matches the TIFF of the same picture apart from JPEG loss. The largest difference of 36 sits on the sharp grid lines, where the TIFF's JPEG tiles and the Zarr chunks, encoded separately, ring differently. That is an assumption from the picture's design and was not located pixel by pixel.

## Follow-ups

- [ADR 0305](../adr/0305-jpeg-chunks-in-ome-zarr-and-absent-inner-chunks.md) records the chunk layout.
- The converted fixtures of INGEST-015 (conversion fallback worker) do not exist yet. The committed stores stand in for them, written by `packages/test-fixtures/scripts/make_synthetic_zarr.py` in the layout that task is asked to produce. TODO: run the same tests on real converted stores when INGEST-015 lands.
- TODO: no brightfield RGB store from IDR was read, only the two-channel fluorescence image.
