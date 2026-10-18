# Slide formats at ingest

How an upload is identified before any reader opens it. The readers per format are in [ADR 0043](../adr/0043-server-slide-reading.md).

## Identification is by content, with extensions only for multi-file formats

`parfocal_ingest.identify.identify(handle, file_name)` reads the first 4 KB. Magic bytes pick TIFF or BigTIFF, ZIP, CZI (`ZISRAWFILE`), ZVI (an OLE compound file), DICOM (`DICM` at byte 128), iSyntax (`DPUfsImport` in a file that is not a TIFF) and plain pictures. Inside a TIFF, `tifffile`'s series flags (`svs`, `ndpi`, `scn`, `bif`, `philips`, `avs`, `ome`) and the `Software` tag (`NDP`, `ScanOutputManager`, `Philips`, `MACROscan` for Huron) name the vendor, and anything else is a generic TIFF. The extension matters only for formats that cannot be judged from one file: `.mrxs`, `.vms`, `.vmu`, `.vsi` and `.ets` are refused with "upload the whole folder as one .zip". A lone `.mrxs` is in fact a JPEG thumbnail, so content alone would call it a picture.

## A zip is either a MIRAX folder or a DICOM set

A zip with a `.mrxs` and a `Slidedat.ini` is MIRAX. A zip whose files are all `.dcm` (or a `DICOMDIR`) is a DICOM set. Two OpenSlide test files with DICOM-looking names are zips of DICOM instances: `CMU-1-JP2K-33005-v2.zip` and `Leica-4.zip`.

## The formats CI job proves the corpus

The `formats` job in `.github/workflows/ci.yml` fetches the `small` and `formats` fixture groups (about 2.3 GB, kept in the Actions cache) and runs `workers/ingest/tests` with `PARFOCAL_REQUIRE_FIXTURES=small,formats`, so a missing fixture fails instead of skipping. The `big`, `huge` and `camelyon` groups are too large for the cache. Their rows skip in CI and run on a machine that has them.
