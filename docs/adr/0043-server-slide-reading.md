# 0043. Server slide reading with OpenSlide first, tiffslide for OME-TIFF and tifffile for validation

- Date: 2026-10-15
- Status: Accepted
- Deciders: Yurii Fedas (owner standing approval)
- Backlog: STACK-026 (slide reading and tiling on the server). Feeds INGEST-003 (ingest workflow skeleton) and the AI inference tasks that tile slides.

## Context

[ADR 0003](0003-pilot-platform-architecture.md) put the Python workers on Modal and the slides in R2. Browsers read the pilot formats directly in the viewer, as POC doc 08 measured. The server needs its own reader for validation, indexing, thumbnails, patches for AI and report images. The backlog default named tifffile and tiffslide, with OpenSlide where it reads better, and TIAToolbox for pixel-size-aware tiling in ML workers. POC doc 20 section 5 found that only the endpoint shape and datastore of MONAI Label were still in use, so no MONAI Label server is planned.

The done-when line asks which library reads each POC format and which fixture proves it. The cloud is paused, so the spike ran on a laptop with local files. Library versions were read from PyPI metadata on 2026-10-15.

## Options considered

The measured facts are in [results/2026-10-15-server-slide-reading-spike.md](../results/2026-10-15-server-slide-reading-spike.md).

1. OpenSlide 4.0.1 through openslide-python 1.4.6 and openslide-bin 4.0.1.2 (LGPL-2.1 library, wheels bundle the C library). It opened every vendor file tried except one BIF, one CZI, a DICOMDIR and one multi-resolution Leica, and it opened MRXS, a DICOM volume file and a stitched BIF. It does not read OME-TIFF sub-pyramids, DICOM directories, CZI or stacked AVS beyond the first plane, and it refuses a few unusual files. It needs a local path.
2. tiffslide 4.0.0 (BSD). A pure-Python TIFF reader that follows the OpenSlide API. It matched OpenSlide to the pixel on every TIFF-family file except two Aperio JPEG 2000 files, where the mean difference is about 0.44. It reads OME-TIFF pyramids and opens in under 1 ms. It does not stitch BIF, cannot read MRXS or DICOM, and failed on the multi-resolution `Leica-3.scn` and the stacked AVS.
3. tifffile 2026.9.20 (BSD). It opens every TIFF-family file and the Leica collection that the other two refuse, but it gives raw pages and series, not a pyramid with pixel size. Its BIF and SCN series are not stitched or aligned. It is the right tool to check structure, not to serve pixels.
4. wsidicom 0.36.1 (Apache-2.0). The only library here that opened a DICOM directory with a DICOMDIR. It opened both DICOM sets with a pyramid and pixel size. It reads nothing else.
5. TIAToolbox for slide reading. Not run in this spike because it pulls PyTorch. It stays the candidate for pixel-size-aware tiling in the ML workers, behind the reader interface chosen here.
6. Convert everything to one format at ingest, with bioformats2raw. Not run. AGENTS.md says to read every POC-supported format natively and convert only when a trigger recorded in an ADR fires.

## Decision

Slides are read behind one server-side reader interface with these rules.

1. OpenSlide is the reader of record for every format it opens. It has the widest coverage, it is the reference that other readers were compared against, and it handles BIF stitching and MRXS.
2. tiffslide reads OME-TIFF and is the fallback when OpenSlide refuses a plain TIFF-family file. In tests it is the second reader that must agree with OpenSlide on the fixtures where both open the file.
3. tifffile identifies and validates every upload by structure (pages, tiling, compression, series) and opens files that no pyramid reader accepts, such as the multi-resolution Leica collection, only to explain why they are refused.
4. wsidicom reads DICOM directories and later DICOMweb.
5. Pixel size comes from the library that serves the pixels, and a value is rejected as unusable when it is above 100 microns per pixel or missing. The generic TIFF fixture reports 1000 and is the reason for the rule.
6. A file that no reader accepts is refused at ingest with a plain reason and the reader error kept out of the user message. It is not converted. A conversion trigger needs its own ADR.
7. TIAToolbox is not part of the reader. It is considered again in AIP-000 (AI research check), where the tiling workers are chosen.
8. Slide files are copied to the worker's local disk before reading. OpenSlide needs a local path, and an MRXS slide needs its folder. Range reads from R2 through fsspec are untested and listed as a TODO.

### Per-format table

The fixture column names the file in `packages/test-fixtures/fixtures.json` (or the POC folder for the larger files) that the spike read. A fixture proves a format here when the named reader opened it and returned a non-blank 512 px region. The automated test that keeps the proof is a follow-up in INGEST-003 (ingest workflow skeleton).

| Format | Server reader | Fixture | Notes |
|---|---|---|---|
| Aperio SVS, JPEG | OpenSlide | `CMU-1.svs`, `CMU-2.svs`, `CMU-1-Small-Region.svs` (one level) | tiffslide agrees to the pixel |
| Aperio SVS, JPEG 2000 (33003 and 33005) | OpenSlide | `JP2K-33003-1.svs`, `JP2K-33003-2.svs`, `CMU-1-JP2K-33005.svs` | tiffslide differs by about 0.44 on the YCbCr files. First read is slower in OpenSlide (16 to 22 ms) |
| Pyramidal TIFF and BigTIFF | OpenSlide | `CMU-1.tiff`, `tumor_009.tif`, `synthetic-jpeg.tiff` | `CMU-1.tiff` reports an unusable pixel size, see rule 5 |
| OME-TIFF | tiffslide | `synthetic-zlib.ome.tiff` | OpenSlide sees 1 level of 3. No real OME-TIFF slide is in the manifest, TODO |
| Hamamatsu NDPI | OpenSlide | `CMU-1.ndpi`, `OS-1.ndpi`, `Hamamatsu-1.ndpi` | OpenSlide adds derived levels. tiffslide agrees to the pixel |
| Ventana BIF | OpenSlide | `OS-1.bif` | `Ventana-1.bif` fails in OpenSlide. tifffile and tiffslide do not stitch, so they are not accepted for BIF. The failing file is a TODO |
| Leica SCN | OpenSlide | `Leica-1.scn` | `Leica-3.scn` is refused by OpenSlide and tiffslide, see rule 6 |
| Philips TIFF | OpenSlide | `Philips-4.tiff`, `Philips-3.tiff` | the TIFF export only. tiffslide agrees to the pixel |
| Huron TIFF | OpenSlide | `Huron-1-40x.tif`, `Huron-1-Uncompressed.tif` | tiffslide agrees to the pixel |
| ARGOS AVS | OpenSlide | `Argos-1.avs` | `Argos-1-Stacked.avs` opens in OpenSlide as one plane. tiffslide refuses it |
| 3DHISTECH MRXS (not in the POC viewer) | OpenSlide | `CMU-1-Saved-1_16.zip` | the folder must be unpacked. tifffile and tiffslide cannot open it |
| DICOM WSI (not in the POC viewer) | wsidicom, OpenSlide for a single volume file | `CMU-1-JP2K-33005-v2.zip`, `Leica-4.zip` | OpenSlide opened a volume file but not a DICOMDIR |
| OME-Zarr and OME-NGFF (viewer default in the POC) | zarr-python | none | not read in this spike. The server reader is a TODO, see below |
| Philips iSyntax and i2Syntax | none | none | closed container, not readable. Refused at ingest, as in the POC |
| Zeiss CZI, Olympus VSI, Sakura, Trestle | none | `Zeiss-5-Flat.czi` (negative) | out of scope in the POC. OpenSlide refuses CZI with JPEG XR compression |

### Rules that follow from the table

- The reader is chosen by file content and not by extension. OpenSlide's `detect_format` and a tifffile structure check run first, and the result is stored with the slide.
- A reader is accepted for a format only when a fixture in the table proves it. A new format or vendor variant needs a fixture first.
- Colour agreement between readers is a test tolerance, not a promise. The test tolerance for the JPEG 2000 YCbCr files is 1.0 mean absolute difference per channel until the cause of the 0.44 is known.

## Consequences

- The reader interface lives in the API and the workers and is written in INGEST-003 (ingest workflow skeleton), along with the fixture tests named in the table. Dependencies to add then are openslide-python, openslide-bin, tiffslide, tifffile, imagecodecs and wsidicom. All support Python 3.14.7 as tested here.
- openslide-bin is LGPL-2.1 and is used as a separate dynamic library. The slide server is not distributed to customers in the pilot, so the licence adds no obligation. TODO: confirm with the owner before any on-premise offer.
- The spike used macOS arm64 wheels only. The Linux wheel behaviour in a Modal image is not tried and is TODO.
- Reading from R2 changes the cost model. A worker copies the slide to its local disk first. The copy time for a large slide is not measured and is TODO. It needs the cloud.
- The viewer stays on its own readers. This ADR does not touch the browser path.
- The backlog entry for STACK-026 can be ticked on this ADR. The edit and the tick are left to the owner of the backlog.
- Open items, all TODO: the failure of `Ventana-1.bif` in OpenSlide, an OME-Zarr reader and fixture, a real OME-TIFF slide, range reads from R2, TIAToolbox in the ML workers, and the cause of the JPEG 2000 YCbCr difference.
