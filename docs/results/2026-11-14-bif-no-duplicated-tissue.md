# Result: a stitched BIF shows the overlap tissue once, and the Viv goldens fail when the frames are drawn as a grid

- Date: 2026-11-14
- Backlog: VIEW-014 (Ventana BIF with frame stitching)
- Kind: check
- Commit: the VIEW-014 commit on top of 3fd5a9a7
- Environment: MacBook, macOS 15.8.1 arm64, Node v26.13.1, Playwright Chromium with SwiftShader, local range server on loopback
- Data: the public OpenSlide test slide `OS-1.bif` (3.9 GB, fixture group `big`, 116 x 75 camera frames of 1024 x 1360) with the trimmed sidecar in `packages/test-fixtures/reference-tiles/OS-1.bif/tile-index.json`. No PHI

## Question

Once `ventana-bif` is registered in the default pixel source registry, does a BIF opened with its sidecar show each piece of tissue once, and does a golden image catch a reader that draws the camera frames as a plain grid?

## Method

1. `node --test test/pixel-source/bif.test.ts` in `packages/viewer-engine` opens a hand-built TIFF of 3 x 2 frames of 32 x 16 pixels that overlap by 6 across and 4 down, with a 4 x 4 mark inside the overlap of all four frames, and counts the marked pixels.
2. `READER_CHECK_MEASURE=1 node --test test/pixel-source/bif-real.test.ts` opens `OS-1.bif` through the default registry and reads a 248 x 256 window around the joint of frame columns 58 and 59 in tissue. For every shift of 100 to 124 pixels across and up to 12 pixels down it takes the mean absolute difference between the strip left of the joint and the strip right of it, and keeps the smallest. A low number means the same tissue is drawn on both sides.
3. `pnpm --filter @parfocal/golden-images exec playwright test render/viv-bif.spec.ts` draws the fit view and a 40x view centred on the frame corner at 53761, 63813, then draws both again with the sidecar's stitching removed.

## Results

| Check | Stitched | Plain frame grid |
|---|---|---|
| Synthetic slide, marked pixels at level 0 (16 scanned) | 16 | 64 |
| Synthetic slide, pixels that differ from the scanned scene | 0 | not compared |
| `OS-1.bif`, closest repeat across the joint, 0 to 255 | 42.48 | 12.34 |
| `OS-1.bif`, level 0 size | 105813 x 93951 | 118784 x 102000 |
| `viv-os-1-bif-fit` golden | matches | fails |
| `viv-os-1-bif-frame-corner-40x` golden | matches | fails |

The two OpenSlide reference windows agree within the 2 grey level limit through the registry. The exact numbers are in [the frame placement result](2026-11-03-bif-frame-placement.md).

## Interpretation

The plain grid repeats the overlap strip, which the search finds at 12.34, and the stitched picture has no such repeat within the searched shifts. The test asserts a plain grid under 20 and a stitched value more than 2.5 times the grid's. The 40x golden still shows OpenSlide's residual seams as brightness steps where four frames meet, which [ADR 0164](../adr/0164-bif-frames-placed-like-openslide.md) (BIF frames placed like OpenSlide) accepted.

## Follow-ups

- The goldens and the real-slide test need `OS-1.bif` from the fixture group `big`, so they skip wherever that group is not cached. TODO: check whether the `formats` CI job caches `big`.
- `Ventana-1.bif` has no stitching in its sidecar and ingest refuses it, so it has no golden.
- The app reads only `tileKind` and `stitching` from `tile-index.json` for a BIF. Using the sidecar's directory offsets for a faster open is not part of this task.
