# Slide formats at ingest

How an upload is identified before any reader opens it. The readers per format are in [ADR 0043](../adr/0043-server-slide-reading.md).

## Identification is by content, with extensions only for multi-file formats

`parfocal_ingest.identify.identify(handle, file_name)` reads the first 4 KB. Magic bytes pick TIFF or BigTIFF, ZIP, CZI (`ZISRAWFILE`), ZVI (an OLE compound file), DICOM (`DICM` at byte 128), iSyntax (`DPUfsImport` in a file that is not a TIFF) and plain pictures. Inside a TIFF, `tifffile`'s series flags (`svs`, `ndpi`, `scn`, `bif`, `philips`, `avs`, `ome`) and the `Software` tag (`NDP`, `ScanOutputManager`, `Philips`, `MACROscan` for Huron) name the vendor, and anything else is a generic TIFF. The extension matters only for formats that cannot be judged from one file: `.mrxs`, `.vms`, `.vmu`, `.vsi` and `.ets` are refused with "upload the whole folder as one .zip". A lone `.mrxs` is in fact a JPEG thumbnail, so content alone would call it a picture.

## A zip is either a MIRAX folder or a DICOM set

A zip with a `.mrxs` and a `Slidedat.ini` is MIRAX. A zip whose files are all `.dcm` (or a `DICOMDIR`) is a DICOM set. Two OpenSlide test files with DICOM-looking names are zips of DICOM instances: `CMU-1-JP2K-33005-v2.zip` and `Leica-4.zip`.

## The formats CI job proves the corpus

The `formats` job in `.github/workflows/ci.yml` fetches the `small` and `formats` fixture groups (about 2.3 GB, kept in the Actions cache) and runs `workers/ingest/tests` with `PARFOCAL_REQUIRE_FIXTURES=small,formats`, so a missing fixture fails instead of skipping. The `big`, `huge` and `camelyon` groups are too large for the cache. Their rows skip in CI and run on a machine that has them.

## The level table comes from the stored file, the scale from the reader

`parfocal_ingest.pyramid.read_pyramid(path, identified)` returns a `Pyramid` or a `Refusal`. Each level has the downsample, the content size, and the stored size, tile size, compression and photometric interpretation. TIFF-family files are read with `tifffile` series, because the browser reads the stored file and must see the same levels. MIRAX goes through OpenSlide and DICOM through wsidicom. Microns per pixel and the objective power come from the reader of record in ADR 0043 (OpenSlide, the OME XML for OME-TIFF, wsidicom for DICOM). A zip is unpacked first with `unpack`, which refuses entries that leave the folder.

- The pyramid is the largest series that is not a thumbnail, label, macro, map, overview or probability image. In `Leica-1.scn` this skips the 1616×4668 macro and takes the 36832×38432 slide. An SCN file with more than one main image (an image whose view is not the whole collection) is refused as multi-region, as OpenSlide does with `Leica-3.scn`.
- The downsample of each level is the smallest power of two above the previous level's that fits both sides: the stored size lies between `floor(base / f) - 1` and `ceil(base / f)` rounded up to the tile size. This covers floor, ceil, Leica's round-half-even and tile padding (POC doc 06, section 14). The content size is `min(stored, ceil(base / f))`. A level that fits no factor is dropped with a `level-skipped` notice. Taking `base / stored` instead is wrong by up to 63% on padded files.
- `tifffile` already reports the content size for Philips TIFF, so the padding rule shows up only on files whose levels are padded in the IFDs. The unit test uses the raw `tumor_009.tif` IFD sizes from the POC.
- BIF levels are stored as unstitched tile grids (118784×102000 for `OS-1.bif`). The content size comes from OpenSlide's stitched level sizes (105813×93951). `Ventana-1.bif` fails in OpenSlide and is refused as unreadable.
- The photometric value is the colour space of the decoded samples. Aperio JPEG 2000 33003 is tagged RGB but decodes to YCbCr, so it is reported as `ycbcr`. DICOM `YBR_ICT` and `YBR_RCT` are reported as `rgb`, because the JPEG 2000 decoder undoes that transform.
- A pixel size above 100 µm or missing is unusable (CMU-1.tiff reports 1000). When it is missing and the objective power is known, it is estimated as `10 / power` with an `mpp-estimated` notice. When the power is missing it is estimated as the nearest of 1.25x, 2.5x, 5x, 10x, 20x and 40x to `10 / mpp` with an `objective-estimated` notice. Philips and Huron files never state the power. With neither value the slide gets `mpp-missing` and `objective-missing`.
- Argos stacked files have 5 focal planes. OpenSlide shows the first, so they get a `first-plane-only` notice.

## Thumbnails and overviews are rendered from the pyramid

`parfocal_ingest.thumbnail.previews` renders a 1024 px overview and a 256 px thumbnail as JPEG ([ADR 0075](../adr/0075-slide-thumbnails-and-overviews.md)). OpenSlide's own `get_thumbnail` is not used, because for Leica SCN it draws the whole glass canvas (53130×153470 for `Leica-1.scn`) with the slide as a small patch. The render crops to `openslide.region[0]` instead. OpenSlide returns RGBA with transparent absent tiles, so the image is flattened onto the slide's background colour. wsidicom's `read_region` takes the level as the power of two (0, 2, 4), not the index.

Goldens live in `workers/ingest/tests/golden/overviews` at 128 px. After a deliberate change, rewrite them with `PARFOCAL_UPDATE_GOLDEN=1 uv run pytest workers/ingest/tests/test_thumbnail.py` and look at every changed image before committing.

## Labels and macros are extracted, never shown by default

`parfocal_ingest.associated.associated_images(path, pyramid)` returns the label as PNG (lossless, so a barcode stays readable) and the macro as JPEG at quality 90, flattened onto white. They come from OpenSlide's associated images, wsidicom's label and overview, or OME series named `label` and `macro`. Labels and macros can carry names and barcodes, so they must be stored apart from the slide and served only as SEC-009 (slide label and macro image handling) allows. Never log them or commit them as goldens. The tests check sizes, format and that the image is not blank. Which files carry what: SVS, Huron, MIRAX, Philips-3 and the DICOM sets have both, NDPI, Leica SCN, BIF, Argos, Philips-4 and the CAMELYON tumour slide have only a macro, and generic TIFF and the CAMELYON test slide have neither. The Leica SCN macro is the 1616×4668 image that the level table skips, and the BIF macro is the `Overview` series of the whole glass.
