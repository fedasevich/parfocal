# 0075. Slide thumbnails and overviews are JPEG renders of the slide pyramid

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: INGEST-010

## Context

Every slide needs a small picture for lists and a larger one for the viewer's navigator and for reports (STACK-035). Many files carry a vendor thumbnail, but not all do (Philips, generic TIFF, DICOM sets without one), some vendor thumbnails include parts of the glass outside the scanned image, and Leica SCN files lay the slide out on a canvas of the whole glass. The picture must show the same image and the same colours as the viewer, with no label or macro (SEC-009).

## Options considered

1. Use the vendor thumbnail where present and render otherwise. It is free to produce, but two code paths give different framing, and the vendor image can include the label area.
2. Render both images from the slide pyramid through the reader of record in ADR 0043 (OpenSlide, wsidicom, or the OME levels). One path for every format, framed exactly like level 0 of the level table from INGEST-006.
3. WebP instead of JPEG. Files are about a third smaller, but PDF libraries do not embed WebP, so reports would need a second copy.

## Decision

Option 2 with JPEG. The overview is 1024 px on the long side and the thumbnail 256 px, both JPEG at quality 85, resized with Lanczos from the coarsest level that is at least as large. Transparent areas (absent tiles, empty canvas) are painted with OpenSlide's background colour or white. For Leica SCN the region is cropped to `openslide.region[0]`, so the picture matches the 36832×38432 level table and not the whole glass.

## Consequences

- `parfocal_ingest.thumbnail.previews(path, format, pyramid)` returns both JPEGs. Storing them waits for uploads to reach storage, like the other ingest steps.
- Colour is checked by golden images at 128 px for every fixture in `workers/ingest/tests/golden/overviews` with a mean absolute difference of at most 3 per channel. A test shows that YCbCr shown as RGB fails it by more than ten times that. The DICOM copy of `CMU-1-JP2K-33005.svs` must match the SVS within the same limit. Goldens are rewritten with `PARFOCAL_UPDATE_GOLDEN=1` and must be looked at before committing.
- ICC profiles embedded in some files are not applied yet. TODO: decide with the colour work in INGEST-009 (seams and correctness check).
- Multi-channel fluorescence OME-TIFF is not handled. TODO: when a fluorescence fixture exists.
