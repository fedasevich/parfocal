# XXXX. The browser reader places BIF camera frames on OpenSlide's even confidence-weighted pitch, not on the per-boundary layout

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-057 (place BIF frames by their stitch positions in the browser reader). Changes how [ADR 0153](0153-sidecar-tile-index.md) (sidecar tile index) uses its BIF stitching layout. Touches VIEW-014 (Ventana BIF with frame stitching)

## Context

A BIF stores every camera frame as one tile, overlapping its neighbours by about a tenth of a frame. ADR 0153 (sidecar tile index) has ingest write a stitching layout with one position per frame column and row, averaged per boundary by confidence, which the POC argued fits the pixels better than one pitch (POC doc 08). INGEST-009 (seams and correctness check) compares the browser reader with OpenSlide, which ingest uses for thumbnails, tissue boxes and level sizes, and VIEW-057 asks for OS-1.bif to agree within 2 grey levels with a seam ratio under 2. Measured in [the result](../results/2026-11-03-bif-frame-placement.md), OpenSlide uses one confidence-weighted overlap per direction, an even fractional pitch, the later frame on top and bilinear resampling.

## Options considered

1. The per-boundary `columnX` and `rowY` the sidecar already carries. Real frame edges score 1.53 and 1.37, but the picture is 19 to 26 grey levels from OpenSlide, its extent is 105822 x 93925 against OpenSlide's 105813 x 93951, and points drift by tens of pixels from every server-side coordinate. The reference tiles would have to come from our own stitcher.
2. An even pitch derived from the level 0 size alone, with no sidecar change. 2.6 at level 0 and 1.65 at level 1 with bilinear sampling, and 3.64 with nearest, so it misses the target on some windows.
3. An even pitch from the confidence-weighted mean overlap, written by ingest as `advanceX` and `advanceY`, with the later frame on top and bilinear sampling. 0.35 in the Python model and 0.57 in the browser at both levels, and it reproduces OpenSlide's level size exactly.

## Decision

Option 3. Ingest adds `advanceX` and `advanceY` to the stitching object, still version 1, and keeps `columnX` and `rowY` so a later switch needs no re-ingest. When the sidecar's `tileKind` is `bif-frames` and `stitching` is present, `openTiffSource` maps each output column and row to a frame and a fractional stored position, reads the stored window that covers them through the existing path (native or script JPEG, absent tiles), and resamples bilinearly within the chosen frame. A sidecar written before this change has no advance, and the reader then derives it from the level 0 size as in option 2. Without a sidecar, or with `stitching` null as on `Ventana-1.bif`, the frames stay a plain grid.

## Consequences

- OS-1.bif agrees with OpenSlide within 0.6 grey levels and joins the reader check, and annotations, tissue boxes and model outputs share one coordinate system across server and browser.
- OpenSlide's residual seams come with it. At the real frame edges the seam ratio is 2.76 and 2.85, against 1.53 and 1.37 for option 1. The default seam check probes the reader's tile grid and reads 0.92 and 0.99, so it does not see this.
- TODO: the owner decides whether seam quality on BIF is worth leaving OpenSlide's coordinates. Moving to option 1 is a change to `frameLayout` plus a new reference, and every stored annotation on a BIF would need its coordinates mapped.
- Ingest and the reader do the stitching arithmetic separately. A change to either must keep the reader check on OS-1.bif green.
