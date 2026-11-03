# Result: server and browser readers agree, and where seams show

- Date: 2026-11-03
- Backlog: INGEST-009 (seams and correctness check)
- Kind: baseline
- Commit: the INGEST-009 commit on top of 58b21f2
- Environment: MacBook, macOS 15.8.1 arm64, Node 26.13.0, Python 3.14 with openslide-bin 4, no browser (the browser reader `openTiffSource` runs in Node with the script JPEG decoder, `nativeJpeg: "off"`)
- Data: the committed synthetic slides and the public OpenSlide test slides `CMU-1-Small-Region.svs`, `CMU-1.svs`, `JP2K-33003-1.svs`, `CMU-1.tiff`, `OS-1.bif` and `CMU-1.ndpi`. No PHI

## Question

Does the browser reader draw the same pixels as the server reader at two levels, and does the seam statistic from the POC's `probe-seams.mjs` separate clean slides from slides whose tiles are misplaced? The POC marks were 1.0 to 1.4 for a clean slide, up to about 2.5 for lossy tiling, and 4.1 for the unstitched `OS-1.bif`.

## Method

`python -m parfocal_ingest.reference_tiles SLIDE DIR` cut one window per level through the ingest reader, centred on a tile corner. `checkAgainstReference` in `packages/viewer-engine/src/pixel-source/reader-check.ts` read the same windows through `openTiffSource` and took the mean absolute error over R, G and B. `checkSeams` ported the POC statistic with its constants (band 8192, depth 96, block 128, texture floor 1.5, at least 4 boundaries, threshold 2.5) and placed the bands on the most textured of 20 probes. Run with `READER_CHECK_MEASURE=1 node --test test/pixel-source/reader-check.test.ts` in `packages/viewer-engine`.

## Results

Mean absolute error between the readers, 0 to 255, at the finest and the next level.

| Slide | Level 0 | Level 1 |
|---|---|---|
| synthetic-jpeg.tiff | 0.30 | 0.20 |
| synthetic-zlib.ome.tiff | 0 | 0 |
| synthetic-big-endian.tiff | 0 | 0 |
| CMU-1-Small-Region.svs | 0.04 | one level only |
| JP2K-33003-1.svs | 0.45 | 0.98 |
| CMU-1.svs | 0.07 | 0.33 |
| CMU-1.tiff | 2.14 | 1.00 |
| OS-1.bif | 52.35 | 65.40 |

Before the sampler rounded its level 0 location to the slide's exact downsample, `JP2K-33003-1.svs` level 1 read 3.96, because OpenSlide interpolates a window that starts between pixels.

Seam ratio, the larger of the vertical and horizontal ratio.

| Slide | Vertical | Horizontal |
|---|---|---|
| CMU-1-Small-Region.svs | 1.08 | 1.65 |
| CMU-1-Small-Region.svs with 40 px frame overlap re-introduced | 4.89 | 4.16 |
| CMU-1.svs | 1.31 | 1.33 |
| CMU-1.tiff | 1.34 | 1.27 |
| OS-1.bif opened without a sidecar index | 2.88 | 3.09 |

Re-introduced failures and what the check reported: YCbCr shown as RGB on `synthetic-jpeg.tiff` 47.1 apart and 0.5 once converted (colour-space), and on `JP2K-33003-1.svs` 42.9 and 0.6. Red and blue swapped 7.1 (channel order). A 3, -2 px shift 7.0 on the synthetic slide and 17.7 on tissue (offset, recovered exactly). The neighbouring tile 109.3 (mismatch). A ladder read with the wrong downsamples gave a missing level or an unreadable window.

`CMU-1.ndpi` did not open in the browser reader without its sidecar index, so it has no row.

## Interpretation

The two readers agree to within 1 grey level on every JPEG 2000, deflate and Aperio JPEG slide and to about 2 on `CMU-1.tiff`, well under the native JPEG agreement threshold of 3 that the check uses. Every re-introduced failure lands at least twice that threshold away and gets its own label. The seam ratios match the POC's marks: clean slides read 1.1 to 1.7 and displaced frames 4 to 5.

`OS-1.bif` is a real gap, not a re-introduced one. The browser reader draws the BIF tile grid without the stitch positions, so it shows seams (about 3) and disagrees with OpenSlide, which places the overlapping frames. The sidecar index carries the stitching (`stitching` in `SlideIndex`) but no browser code reads it yet.

## Follow-ups

- TODO: the browser reader should place BIF frames from the sidecar's stitching, then `OS-1.bif` joins the reference slides. Needs a backlog task.
- TODO: ICC profiles are still applied by neither reader, so this check cannot see them. ADR 0075 (slide thumbnails and overviews) left the decision to this task and it is open with the owner.
