# 0099. The browser reads TIFF with geotiff.js and OME-Zarr with zarrita, behind one PixelSource interface with a tested workaround for each known reader bug

- Date: 2026-10-23
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-016, VIEW-003. Touches VIEW-002, VIEW-004, VIEW-005, VIEW-010 to VIEW-017, INGEST-007, INGEST-008 and VIEW-000.

## Context

STACK-016 asks which libraries read TIFF and Zarr in the browser, with geotiff.js and zarrita as the default because the POC used them, and with the known geotiff bugs worked around: YCbCr, lazy directories and big-endian BigTIFF offsets. VIEW-003 asks for one `PixelSource` interface over every format, chosen by the ingest format id and reading the sidecar index, with a conformance suite run against every implementation.

The POC found the bugs the hard way (POC doc 06 notes 4, 10, 12, 13 and 14, doc 03 on colour handling and padded levels, doc 08 on sparse tiles and JPEG 2000, doc 32 on the big-endian Vanderbilt file). Every one of them produced a plausible wrong picture or a silent hang rather than an error. The sidecar index of INGEST-007 does not exist yet.

## Options considered

1. geotiff.js and zarrita behind our own `PixelSource`, with each workaround in our wrapper and pinned by a test. Both are pure JavaScript, read over HTTP range requests and run in workers. geotiff.js reads every TIFF-family layout we need except JPEG 2000 tiles and SubIFD pyramids, and has the bugs listed below. zarrita reads Zarr v2 and v3 with sharding through one API.
2. Viv's own loaders (`loadOmeTiff`, `loadOmeZarr`, `loadMultiTiff`). They read only OME formats. POC doc 03 showed `loadMultiTiff` collapsing a ten-level scanner pyramid to one level and three samples to the Y plane, and the loaders sit on the same geotiff.js, so the bugs remain and are harder to reach.
3. A WebAssembly build of libtiff. Not tried in a spike. libtiff reads through a file handle, so streaming range requests would need a custom I/O layer, and the JPEG and deflate decoders would ship in the module as well. TODO: measure module size and open time if option 1 ever fails a budget.
4. Our own TIFF directory reader with only decoders borrowed. Full control over every byte, but it means owning the TIFF parser. Worth revisiting once INGEST-007 hands the browser every tile offset, because the browser then only fetches byte ranges and decodes.

## Decision

Option 1, because it is what the POC proved on every supported format, and the wrapper makes each known bug a tested line of our code rather than a surprise. Versions are pinned exactly: `geotiff@3.0.5` (released 2026-03-11) and `zarrita@0.7.5` (released 2026-09-01).

### The interface

`packages/viewer-engine/src/pixel-source/types.ts` defines `PixelSource`. It reports the format id, the levels finest first (downsample, content width and height without tile padding, tile width and height), the level 0 tile size, microns per pixel or `null`, the photometric mode of the decoded planes (`rgb`, `grey` or `channels`), the dtype and the channels with name, colour and display window. `getTile` and `getRaster` return planar typed arrays at their true size, so an edge tile is short and never padded. A tile with nothing stored comes back as `{ absent: true, width, height }`, and the renderer decides whether to fall back to a coarser level or paint background. Requests outside the pyramid reject with `RangeError`, an aborted signal rejects with `AbortError`, and a closed source rejects with `SourceClosedError`.

### Selection by format id

`createDefaultPixelSourceRegistry()` selects by the ingest worker's format ids, and a test reads `parfocal_ingest.identify.Format` so the two lists cannot drift. `ome-zarr` is new and is not produced by ingest yet.

| Format ids | Source |
|---|---|
| `generic-tiff`, `ome-tiff`, `aperio-svs`, `philips-tiff`, `huron-tiff`, `argos-avs`, `leica-scn` | geotiff.js source, for TIFFs whose tile grid is the picture |
| `ome-zarr` | zarrita source |
| `hamamatsu-ndpi`, `ventana-bif` | refused with `UnsupportedFormatError` until VIEW-013 (NDPI) and VIEW-014 (BIF), because their tiles are not the picture |
| `mirax`, `dicom` | refused, out of scope for v1 |

### The sidecar index is optional

`OpenRequest.index` takes a `SlideIndex` with the format id, the levels (main-chain IFD number, downsample, content size), microns per pixel and the Zarr version. When it is given, the TIFF source uses its levels and pixel size instead of walking the pages and recovering the ladder, and the Zarr source opens the stated version without probing. An index for a different format id is refused. The shape is provisional until INGEST-007 (sidecar tile index), which will add tile offsets and byte counts. TODO: INGEST-007 must also say how a level stored in a SubIFD is named, because `page` names only main-chain IFDs today.

### Every workaround and its fixture

Each row has a test in `packages/viewer-engine/test/pixel-source/workarounds.test.ts` that shows the raw library going wrong on the fixture and the source getting it right. Committed fixtures run in CI. Cached fixtures run where `pnpm fixtures` has fetched them and skip elsewhere.

| # | Problem in the library | Workaround | Fixture |
|---|---|---|---|
| 1 | geotiff's JPEG decoder returns Y, Cb and Cr, and `readRasters` applies no photometric transform, so YCbCr tiles show as a flat wash (POC doc 06 note 13) | Photometric 0, 3, 5, 6 and 8 at 8 bits are read with `readRGB`, RGB and BlackIsZero with `readRasters` | `synthetic-jpeg.tiff` (committed, photometric 6), compared with the lossless `synthetic-zlib.ome.tiff`. `tumor_009.tif` (cached) reads glass as 255, 255, 255 where raw Cb is 128 |
| 2 | Directories are lazy. Deferred tags are not properties, `getValue` throws for them, and awaiting one inside the tile path wedged the POC's renderer (POC doc 06 note 12) | Every tag the source needs (ImageDescription, resolution, SubIFDs, TileByteCounts) is loaded with `loadValue` while opening, never while reading tiles | `synthetic-zlib.ome.tiff` (committed), whose OME-XML description is deferred and still gives 0.5 µm |
| 3 | Big-endian files: `DeferredArray` in `imagefiledirectory.js` builds its `DataSlice` with little-endian hard-coded, so deferred offset arrays are read in the wrong byte order. A BigTIFF fails with "exceeds MAX_SAFE_INTEGER" (POC doc 32) | For big-endian files the parser is switched to eager, so offset arrays are read while parsing the directory, in the file's byte order | `synthetic-big-endian.tiff` (committed, big-endian BigTIFF with 32 px tiles), read pixel for pixel equal to the lossless OME-TIFF |
| 4 | A tile with byte count 0 decodes as zeros, which `readRGB` turns into (0, 135, 0) on a YCbCr file (POC doc 06, doc 08) | Byte counts are read at open. An absent tile is returned as absent without a request, and a raster that spans absent tiles is painted with background (255 for RGB) there | `synthetic-sparse.tiff` (committed, level 0 tiles 1, 6 and 7 left out). `Philips-4.tiff` (cached) |
| 5 | geotiff walks only the main IFD chain, so an OME-TIFF pyramid in SubIFDs has one level | SubIFD offsets are parsed with `tiff.parser.parseFileDirectoryAt` and wrapped as `GeoTIFFImage`s, and each main IFD with SubIFDs starts its own pyramid | `synthetic-zlib.ome.tiff` (committed): geotiff sees 1 image, the source 3 levels |
| 6 | Not a geotiff bug, but the reader trap that cost the POC most: stored level sizes include tile padding, so `base / stored` is wrong by up to 63% (POC doc 06 note 14) | `recoverLadder` applies the same rule as `parfocal_ingest.pyramid.ladder`, the smallest power of two that fits both sides, and reports the content size | The padded IFD sizes of `tumor_009.tif` in a unit test, plus the conformance runs on cached slides, whose level tables equal the ingest worker's |
| 7 | geotiff has no JPEG 2000 decoder, so Aperio 33003 and 33005 open and then fail on the first tile | The source asks geotiff for a decoder while opening and refuses with `UnsupportedCodecError` naming the compression. VIEW-011 (SVS JPEG 2000) registers OpenJPEG and removes the refusal | `JP2K-33003-1.svs` (cached) |
| 8 | zarrita's `FetchStore` throws on a relative URL (POC doc 06 note 10) | URLs are resolved against `baseUrl` or the page before the store is made | Generated OME-Zarr 0.5 store |
| 9 | zarrita returns `fill_value` for a missing chunk, so an unwritten chunk draws as black (POC doc 03) | A store wrapper turns a missing chunk key into `AbsentChunkError`, `getTile` returns absent, and `getRaster` composes from tiles with background where chunks are missing | Generated sparse OME-Zarr 0.4 store |

Two POC problems no longer need a workaround, and their tests stay as regression tests:

- Vite's SPA fallback answering a Zarr probe with HTML (POC doc 06 note 4). zarrita 0.7.5 moves on to v3 when the v2 metadata is not JSON, and a test opens a v3 store behind such a server.
- geotiff resolving the directory differently in Node and the browser (POC doc 06 note 12). In 3.0.5 the module and browser builds come from the same source, with the same lazy `ImageFileDirectory`, so the tests in Node see what the browser sees. Row 2 still applies.

### What the generic source reads for scale

Aperio `MPP` in the description, `PhysicalSizeX` and `PhysicalSizeY` in OME-XML, then the resolution tags. Vendor XML such as Philips `DICOM_PIXEL_SPACING` gives `null`, and the slide index from ingest, which reads it through OpenSlide, supplies the value. Values above 100 µm are treated as missing, as in ingest.

## Consequences

- The conformance suite (`test/pixel-source/conformance.ts`) runs against both implementations: the geotiff source on the four committed TIFF fixtures, with a slide index, and on the cached slides `CMU-1-Small-Region.svs`, `CMU-1.svs`, `CMU-1.tiff`, `tumor_009.tif`, `Philips-4.tiff`, `Huron-1-40x.tif`, `Argos-1.avs` and `Leica-1.scn`, and the zarrita source on generated OME-Zarr 0.4 and 0.5 stores in 8-bit RGB, 16-bit grey and sparse form. CI has only the `small` group, so there it runs the committed fixtures and `CMU-1-Small-Region.svs`.
- `packages/test-fixtures` gained `synthetic-big-endian.tiff` and `synthetic-sparse.tiff`, made by `make_synthetic.py`.
- VIEW-002 (Viv route) wraps a `PixelSource` and adds Viv's virtual 2^i levels, because Aperio and Huron store 1x, 4x and 16x.
- VIEW-004 (decode worker pool) and VIEW-006 (shared decode cache) sit on top of `getTile`, which today decodes on the calling thread.
- VIEW-005 (native JPEG decode) must apply the photometric transform exactly once. geotiff's JPEG decoder returns raw components and `readRGB` converts them. A native decoder that already returns RGB must not be followed by `readRGB`.
- VIEW-010 to VIEW-016 add golden images and per-vendor checks on top of the same source. For VIEW-015 (Leica SCN), `Leica-1.scn` already opens the 36832×38432 slide rather than the 1616×4668 macro in the conformance run.
- VIEW-017 (OME-Zarr) adds sharding, the JPEG chunk codec and absent inner chunks. An inner chunk missing inside a shard that exists still reads as fill, and INGEST-008 (absence map) closes that.
- INGEST-007 (sidecar tile index) fills in `SlideIndex`.
- TODO: report the big-endian `DeferredArray` bug to geotiff.js upstream and drop row 3 once a fixed release is old enough to install.
