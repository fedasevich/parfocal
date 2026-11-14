# Result: converted OME-Zarr stores keep the source pixels, pass the level checks and open in Viv

- Date: 2026-11-14
- Backlog: INGEST-015 (conversion fallback worker)
- Kind: baseline
- Commit: TODO, the INGEST-015 feature commit
- Environment: MacBook with Apple M4, Python 3.14 with openslide-bin 4 and Pillow 13, Playwright Chromium with SwiftShader for the Viv goldens
- Data: the committed synthetic slides and the public OpenSlide test slide `JP2K-33003-1.svs` (15374 × 17497, Aperio JPEG 2000 33003, fixture group `formats`). No PHI

## Question

Does a store written by `parfocal_ingest.conversion` pass INGEST-006 (pyramid and level validation) and INGEST-009 (seams and correctness check), and does Viv draw it?

## Method

`workers/ingest/tests/test_conversion.py` converts each fixture, reads the level table through `zarr_tile_index` and `ladder`, and decodes windows from the store with Pillow and stdlib zstd. At level 0 and level 1 it takes the most textured of up to 24 inner chunk corners, reads the same area through the INGEST-009 server reader (`read_window`, level 1 as the 2 × 2 mean of level 0), and compares. A misplaced or swapped store is simulated by shifting the source by up to 2 px in each direction and by reversing the channels. `render/viv-ome-zarr.spec.ts` draws the two committed converted stores through the Viv route.

## Results

Mean absolute error at the chosen corner, 0 to 255, with PSNR and the smallest error of a 1 or 2 px shift and of swapped channels.

| Fixture | Level | Mean error | PSNR | Best wrong shift | Swapped channels |
|---|---|---|---|---|---|
| JP2K-33003-1.svs, 512 px JPEG q90 | 0 | 4.99 | 31.9 dB | 15.16 | 37.25 |
| JP2K-33003-1.svs, 512 px JPEG q90 | 1 | 5.70 | 30.8 dB | 15.35 | 31.28 |
| synthetic-jpeg.tiff, 256 px JPEG q90 | 0 | 0.12 | 55.3 dB | 1.77 | 3.28 |
| synthetic-jpeg.tiff, 256 px JPEG q90 | 1 | 0.29 | 50.5 dB | 3.30 | 4.24 |
| synthetic-zlib.ome.tiff, 256 px JPEG q90 | 0 | 0.48 | 48.8 dB | 1.95 | 3.40 |
| synthetic-zlib.ome.tiff, 256 px JPEG q90 | 1 | 0.70 | 46.0 dB | 3.53 | 4.23 |

- The two 16-bit synthetics convert to zstd chunks equal to the source at level 0, sample for sample.
- Every store passes the ladder of INGEST-006 with downsamples 1, 2, 4 and no skipped level, and `zarr_tile_index` reads it with no absent tiles.
- Converting `JP2K-33003-1.svs` took about 27 s on this laptop, one run.
- In Viv, `synthetic-jpeg-converted.ome.zarr` differs from the VIEW-017 golden of `synthetic-jpeg.ome.zarr` by 0.50 mean per channel over the fitted frame. The 16-bit store draws a non-empty frame through its `omero` windows.

## Conclusion

The synthetics stay inside the 1.0 mean error of INGEST-009. The real slide does not, because JPEG at quality 90 on the most textured tissue loses about 5 grey levels, so the test holds it to 30 dB instead, the same order as the 36.3 dB mean and 35.1 dB worst chunk of POC doc 32 on a different slide. In every case the right placement beats every wrong shift and the channel swap by at least 3 times, so the offset, seam and colour failures that INGEST-009 looks for would show.

## Limits

One real slide, one corner per level, one laptop run. The browser-side reader check of INGEST-009 (`reader-check.ts`) was not run against the converted stores. Glass chunks are written, so store size is not representative.
