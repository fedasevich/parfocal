# 0408. MIRAX and DICOM slides are served as a lossless pyramid TIFF made at ingest

- Date: 2026-11-20
- Status: Accepted
- Deciders: Yurii Fedas, proposed by the agent doing VIEW-081 (slides that arrive as a MIRAX or DICOM zip open in the viewer) with PROTO-100 (a slide that came in a zip reads as its own format)
- Amends [ADR 0306](0306-conversion-triggers-and-the-ome-zarr-target.md) (conversion triggers and the OME-Zarr target), [ADR 0316](0316-jpeg-2000-slides-stay-native.md) (JPEG 2000 slides stay native, whose `FIRED` was empty) and [ADR 0099](0099-tiff-and-zarr-readers-in-the-browser.md) (TIFF and Zarr readers in the browser, which refused MIRAX and DICOM for v1)

## Context

The deployed walkthrough of 2026-11-20 found that the two gallery zips, `CMU-1-Saved-1_16.zip` (MIRAX) and `CMU-1-JP2K-33005-v2.zip` (DICOM), never open. The engine has no MIRAX or DICOM pixel source, the edge refuses range reads of `original.zip` because the slide has no ranges file, and no tile index exists.

AGENTS.md asks that every POC-supported format is read natively. [ADR 0043](0043-server-slide-reading.md) (server slide reading) marks both formats "not in the POC viewer", so that rule does not bind them, and conversion needs a trigger recorded in an ADR.

Three facts limit a native browser reader. Both formats are several files, so they arrive as one zip, and the probe found the members deflated (MIRAX compression types 0, 8 and 8, DICOM 8 throughout), so no range read reaches a tile inside the archive. The edge serves flat file names and one restricted original per token, so a multi-file original or an OME-Zarr store would need a new token claim and edge rules. MIRAX tiles overlap and sit at camera positions that OpenSlide resolves, which a browser reader would have to repeat.

## Options considered

1. A native browser reader for each format, over an unpacked copy of the archive. The token, the edge and the ranges file would all have to cover many files per slide, and the MIRAX layout logic would be rewritten in TypeScript.
2. Convert at ingest to OME-Zarr, as ADR 0306 set for JPEG 2000. The edge cannot serve a nested store without new path rules.
3. Convert at ingest to one tiled BigTIFF that the existing generic TIFF reader opens. The token, the edge, `levels.json`, `tile-index.json` and the ranges file work unchanged, and no reader code reaches the browser.
4. Repack the DICOM JPEG 2000 frames into a TIFF without decoding them. Byte exact and small, but the frames are `YBR_ICT` and MIRAX needs decoding anyway, so it is a second path for one format.

## Decision

Option 3.

- `parfocal_ingest.conversion.Trigger` gains `mirax-or-dicom`, which applies only to `Format.MIRAX` and `Format.DICOM` and is in `FIRED`. It is not "convert whatever no reader opens", which ADR 0306 rejected. Any other format still needs its own trigger.
- `parfocal_ingest.pyramid_tiff` reads every source level with the reader of record, OpenSlide for MIRAX and wsidicom for DICOM, in 2048 px blocks into a memory-mapped file. It writes one BigTIFF with the same levels and sizes, 256 px tiles, deflate level 6 with the horizontal predictor, and the source's microns per pixel as resolution tags. No label, macro or vendor text is copied, so its ranges file is empty.
- Pixels are kept exactly, as decision 104 chose for converted JPEG 2000 in [ADR 0310](0310-converted-jpeg-2000-slides-are-lossless-and-keep-the-source-levels.md). The test compares every level with OpenSlide pixel for pixel.
- The slide keeps its own format, `mirax` or `dicom`, with the variant `pyramid-tiff`, so the app names it truthfully. The viewer engine opens a `mirax` or `dicom` slide whose served original is a TIFF as `generic-tiff`, and still refuses one whose original is the archive.
- A zipped fixture is published in its own folder, `fixture-slides/<slug>-pyramid-tiff/`, holding `original.tiff` and its derived files but not the archive. The old `fixture-slides/<slug>/` folders are left as they are, because that tool never overwrites or deletes.
- The seed names these slides by stem and format, such as `CMU-1-Saved-1_16 (MIRAX)`, and model results are still found under the fixture file name.

## Consequences

- Measured on the owner's Mac ([result](../results/2026-11-20-mirax-and-dicom-pyramid-tiff.md)): the MIRAX fixture of 3.8 MB became 18.7 MB in about 4 s, and the DICOM fixture of 127 MB became 1.08 GB in 108 s with 3.6 GB peak resident memory. R2 storage for both is about $0.02 a month.
- At 8.5 times the archive, lossless storage is the cost of exact pixels. 100 DICOM slides of 1 GB would cost about $13 a month in R2. Decision 165 in decisions.md asks the owner whether converted MIRAX and DICOM may use JPEG q90 tiles, which would bring them near their source size.
- Uploaded MIRAX and DICOM zips are not converted yet. The ingest workflow still publishes the archive, so an uploaded zip still does not open. Wiring the converter into the upload workflow is the follow-up.
- `python -m parfocal_ingest.fixture_slides` must run against the bucket before the next deployed reset, because the deployed seed requires every gallery folder and now looks in the new pyramid folders.
- Cell crops are cut from the pyramid TIFF like any other TIFF, since the slide's original key now points at it.
- `python -m parfocal_ingest.fixture_slides --into DIR` writes the same folder locally, which the browser test and dev server use.
