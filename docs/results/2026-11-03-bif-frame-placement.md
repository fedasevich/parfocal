# Result: the browser reader places BIF frames like OpenSlide and agrees within 0.6 grey levels

- Date: 2026-11-03
- Backlog: VIEW-057 (place BIF frames by their stitch positions in the browser reader)
- Kind: check
- Commit: the VIEW-057 commit on top of 3341704
- Environment: MacBook, macOS 15.8.1 arm64, Node 26.13.0, Python 3.14 with openslide-bin 4 and Pillow, no browser (`openTiffSource` runs in Node with the script JPEG decoder, `nativeJpeg: "off"`)
- Data: the public OpenSlide test slide `OS-1.bif` (116 x 75 camera frames of 1024 x 1360). No PHI

## Question

How does OpenSlide place the overlapping camera frames of a BIF, and does the browser reader match it within 2 grey levels with a seam ratio under 2 once it places frames the same way? The earlier check ([reader seams and agreement](2026-11-03-reader-seams-and-agreement.md)) had OS-1.bif 52.35 and 65.40 apart with seam ratios of 2.88 and 3.09.

## Method

`python -m parfocal_ingest.reference_tiles` cut the two OpenSlide reference windows (level 0 at 53120, 63792 and level 1 at 17280, 24352, 256 px each). A scratch Python script rebuilt the same windows from the raw frames under each candidate layout and compared them with the mean absolute error over R, G and B. Three more OpenSlide windows at levels 2, 4 and 5 checked the chosen model at coarse zoom. The browser numbers come from `READER_CHECK_MEASURE=1 node --test test/pixel-source/reader-check.test.ts` in `packages/viewer-engine`, with the trimmed sidecar in `packages/test-fixtures/reference-tiles/OS-1.bif/tile-index.json`.

## Results

Python reconstruction against OpenSlide, mean absolute error, 0 to 255. The later frame wins where two overlap unless the row says otherwise.

| Layout | Sampling | Level 0 | Level 1 |
|---|---|---|---|
| Per-boundary `columnX` and `rowY` from the sidecar | nearest | 19.30 | 26.19 |
| Per-boundary, the earlier frame wins | nearest | 20.44 | 26.79 |
| Even pitch from OpenSlide's level 0 size | nearest | 3.64 | 2.08 |
| Even pitch from OpenSlide's level 0 size | bilinear | 2.60 | 1.65 |
| Even pitch, unweighted mean of registered joints | nearest | 6.59 | 5.98 |
| Even pitch, confidence-weighted mean of all joints | nearest | 2.27 | 2.08 |
| Even pitch, confidence-weighted mean of all joints | bilinear | 0.35 | 0.35 |
| Even pitch, confidence-weighted, the earlier frame wins | nearest | 13.41 | 10.00 |

The weighted advance is 911.202577 px across and 1251.221749 px down. It also reproduces OpenSlide's level 0 size exactly: 115 x 911.2026 + 1024 rounds up to 105813 and 74 x 1251.2217 + 1360 rounds up to 93951. The per-boundary extent is 105822 x 93925. The same model with bilinear sampling read 0.45 at level 2, 0.57 at level 4 and 1.54 at level 5.

Browser reader against the OpenSlide references, before and after.

| Reader | Level 0 | Level 1 | Seams at tile grid, vertical | horizontal | Seams at frame edges, vertical | horizontal |
|---|---|---|---|---|---|---|
| Before, frames drawn as a grid | 52.35 | 65.40 | 2.88 | 3.09 | not measured | not measured |
| After, weighted even pitch, bilinear | 0.57 | 0.57 | 0.92 | 0.99 | 2.76 | 2.85 |
| Per-boundary layout, bilinear, not shipped | 19.37 | not measured | 1.05 | 1.24 | 1.53 | 1.37 |

The tile-grid seam ratio is the one `checkSeams` reports by default. It probes the reader's 1024 and 1360 px tile edges, which after stitching are no longer where frames meet. The frame-edge columns probe `ceil(k x advance)` instead, through the new `edges` option.

## Interpretation

OpenSlide reduces every joint to one confidence-weighted overlap per direction, lays the frames on an even fractional pitch, draws each later frame over the earlier one and resamples bilinearly at the fractional offset. The browser reader now does the same and agrees with OpenSlide at the noise floor of two JPEG decoders, so OS-1.bif joins the reference slides. Its coordinates are OpenSlide's, which is what thumbnails, tissue boxes, annotations and server-side models use.

Matching OpenSlide also copies its residual seams. At the real frame edges the even pitch scores 2.76 and 2.85, close to the 2.88 and 3.09 of the unstitched grid, while the per-boundary layout the POC proposed scores 1.53 and 1.37 but sits 19 grey levels and tens of pixels away from every server-side coordinate.

## Follow-ups

- TODO: the owner decides whether BIF keeps OpenSlide's placement or moves to the per-boundary layout with a reference that is not OpenSlide. Recorded in the hand-back for `docs/decisions.md`.
- TODO: `checkSeams` uses the reader's tile grid by default, which hides seams that a stitched format puts elsewhere. A stitched reader should report its frame edges.
- `ventana-bif` is still not registered in the default pixel source registry and there is no BIF golden image. Both belong to VIEW-014 (Ventana BIF with frame stitching).
