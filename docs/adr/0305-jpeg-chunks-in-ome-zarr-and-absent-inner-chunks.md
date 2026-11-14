# 0305. OME-Zarr JPEG chunks are a zarrita codec named `imagecodecs_jpeg`, and absent inner chunks of a shard come from the slide index

- Date: 2026-11-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-017 (OME-Zarr v0.4 and v0.5 sharded with JPEG and lossless codecs). Sets the store layout for INGEST-015 (conversion fallback worker). Builds on [ADR 0099](0099-tiff-and-zarr-readers-in-the-browser.md) (TIFF and Zarr readers in the browser) and INGEST-008 (sparse tile and absent chunk map).

## Context

The browser already read OME-Zarr 0.4 and 0.5, sharded or not, with uncompressed chunks. VIEW-017 adds what a converted slide needs: JPEG chunks for brightfield, lossless codecs for 16-bit data, and a correct answer for an inner chunk that a shard leaves out. zarrita looks codecs up by name in one registry for the whole module, so a codec never sees the open request. zarrita also returns the fill value for an empty entry of a shard index, without asking the store, so the store wrapper of ADR 0099 cannot see the miss.

## Options considered

1. JPEG decoding: a codec in zarrita's registry, or reading chunk bytes ourselves and bypassing zarrita. The registry keeps slicing, sharding and range coalescing in one place. Bypassing zarrita would repeat them.
2. Choosing the decoder per slide: one global setting, or a token that the store wrapper writes into the codec configuration of the array metadata as it passes through. A global setting cannot honour `nativeJpeg: "off"` for one slide while another uses the browser decoder, and it cannot give each slide its own decode report.
3. Absent inner chunks: read every shard index in the browser a second time, or take the absence map from the slide index that ingest writes. The second costs no request and is how TIFF already works.

## Decision

- The codec is registered when the Zarr source module loads, under `imagecodecs_jpeg` and `numcodecs.imagecodecs_jpeg`, so a decode worker has it as soon as it imports the source. Zarr version 2 names it as the compressor `{"id": "imagecodecs_jpeg"}`, which is what the POC wrote. Version 3 lists it after `bytes`, also inside `sharding_indexed`.
- A JPEG chunk holds all three channels of one tile: chunk shape `[3, height, width]`, 8-bit, baseline, padded to the full chunk size. The codec returns the three planes in channel order. Any other shape or data type is refused with `JpegChunkError`.
- Each open source gets its own decoding context, found through a token in the codec configuration. The context decides once, as the TIFF and NDPI sources do: the browser decoder is used when it agrees with the script decoder within `nativeAgreementThreshold`, and `decodeReport()` says which one read the chunks.
- Lossless chunks need no code of ours. zarrita's own `zstd`, `blosc`, `gzip` and `lz4` codecs read them.
- `parfocal_ingest.zarr_index` now reads shard indexes. It reports the inner chunk as the tile, and an empty index entry or a missing shard file as an absent tile. It reads `bytes` index codecs with or without `crc32c`, at the start or the end of the shard, and refuses anything else.
- Without a slide index, an inner chunk left out of an existing shard still reads as fill. A test pins that, so the limit is visible.

## Consequences

- INGEST-015 must write this layout. With 4:4:4 chroma the browser decoder agrees with the script decoder. Subsampled chroma would fall back to the slower script decoder, as Aperio SVS does.
- zarrita 0.7.5 always reads the shard index from the end of the file. A store with `index_location: "start"` is indexed by ingest and is not readable in the browser. TODO: refuse it at open with a clear error, or read it, if such a store ever arrives.
- Numbers are in [the result file](../results/2026-11-14-ome-zarr-jpeg-and-sharded-stores.md).
