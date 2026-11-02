# XXXX. Ingest writes a gzipped JSON tile index next to each TIFF-family slide, and the browser opens the directories it names in parallel instead of walking the IFD chain

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: INGEST-007 (sidecar tile index). Touches VIEW-013 (NDPI), VIEW-014 (BIF), VIEW-049 (deliver the tissue box to the viewer) and [ADR 0099](0099-tiff-and-zarr-readers-in-the-browser.md) (TIFF and Zarr readers in the browser).

## Context

A TIFF stores the offset of each directory in the one before it, so a reader that knows nothing else must fetch the directories one after another. The POC measured 4.2 s to open a CAMELYON16 BigTIFF across the Atlantic, eleven dependent reads at about 200 ms each (POC doc 03 and doc 09). INGEST-007 asks for a sidecar written at ingest that lists every directory and every tile, with the NDPI restart index and the BIF stitching layout, so the browser opens a slide in under 1 s at 100 ms RTT. ADR 0099 left a TODO to say how a level stored in a SubIFD is named.

## Options considered

1. JSON with plain offset and byte-count arrays, stored gzipped with `Content-Encoding: gzip`. One object per slide, read by `fetch` with no decoder of our own. Offsets are written as the gap after the previous tile ends, which is 0 for tiles stored in order.
2. A binary file of little-endian 64-bit offsets and 32-bit counts with a small JSON header. About a third smaller before gzip, but a second format to version and a parser on both sides.
3. A sidecar that also carries every tag geotiff reads, so the browser builds `ImageFileDirectory` objects with no request to the TIFF at all. Saves one round trip but couples the sidecar to geotiff's internal value types, and ADR 0099 option 4 (our own directory reader) is the better home for that.

## Decision

Option 1. The `index` step writes `tile-index.json` under the slide prefix (`t/{tenant}/s/{slide}/`), next to `levels.json`, gzipped with mtime 0. No database change.

- Version 1 holds `formatId`, `tileKind` (`grid`, `ndpi-restart` or `bif-frames`), `littleEndian`, `bigTiff`, `micronsPerPixel` and one entry per pyramid level as ingest's `read_pyramid` chose it. Each level has `page` and `subIfd` (the main-chain directory number, and the position in that directory's SubIFDs or `null`), `ifdOffset`, the content `width` and `height`, `downsample`, `tileWidth`, `tileHeight`, `jpegHeader` (base64 JPEGTables, or tifffile's `jpegheader` for NDPI), `tileOffsetGaps`, `tileByteCounts` and `siblings`, the other pages of the same level (OME channels) in the same shape. This settles the ADR 0099 TODO: a SubIFD level is `(page, subIfd)` and both sides also carry the byte offset.
- Only the main pyramid is listed. Label and macro pages, ImageDescription text and XMP never reach the sidecar, so it reveals nothing the restricted ranges hide.
- NDPI: tifffile already splits each level's single JPEG into restart intervals using tag 65426 and recovers the high bits of offsets past 4 GB, so the tile table is the restart-marker index. A test decodes one interval with the header and an end-of-image marker. Only checked on files under 4 GB.
- BIF: the stitching layout (`columns`, `rows`, frame size, `columnX`, `rowY` and the stitched extent) is computed from the level 0 XMP with confidence-weighted overlap per boundary and the serpentine frame numbering found by the POC. It is `null` when the frames need no correction.
- Not written for MIRAX, DICOM or a zip upload, because the published original of a zip is the archive and offsets would point into a member.
- Browser: `readTileIndex` validates the document. When every level names its directory, `openTiffSource` parses those directories in parallel with `parseFileDirectoryAt` and puts the tile tables into geotiff's directory, so it never calls `getImageCount` and never fetches TileOffsets or TileByteCounts. Without a sidecar it walks the chain as before.

## Consequences

- At 100 ms RTT the spread 11-directory BigTIFF opens and reads its first tile in about 0.38 s with the sidecar against 1.39 s by walking. Numbers are in [the result](../results/2026-11-02-sidecar-tile-index.md).
- The sidecar for `tumor_009.tif` is 1.5 MB of JSON and 0.53 MB gzipped. TODO: move to option 2 if a slide's sidecar download dominates its open time.
- The open still costs the TIFF header read, the sidecar read and one parallel wave of directory reads. Fetching the header and the sidecar at the same time would save one round trip.
- VIEW-013 and VIEW-014 read `tileKind`, `jpegHeader` and `stitching` instead of re-deriving them in the browser. VIEW-049 (deliver the tissue box to the viewer) or the slide API must serve the sidecar and pass it as `OpenRequest.index`.
- Slides ingested before this change have no sidecar until they are re-ingested, and the reader falls back to the walk.
