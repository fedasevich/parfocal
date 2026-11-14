# XXXX. Conversion runs only on a fired trigger, and writes unsharded OME-Zarr 0.5 with JPEG or zstd chunks

- Date: 2026-11-14
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: INGEST-015 (conversion fallback worker). Builds on [ADR 0043](0043-server-slide-reading.md) (server slide reading, whose rule 6 says a conversion trigger needs its own ADR), [ADR 0111](0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md) (JPEG 2000 in the decode workers, which names the only trigger so far) and [ADR 0305](0305-jpeg-chunks-in-ome-zarr-and-absent-inner-chunks.md) (the JPEG chunk layout the browser reads).

## Context

AGENTS.md says every POC-supported format is read natively and converted only when a trigger recorded in an ADR fires. No ADR listed triggers yet. ADR 0111 names one candidate: JPEG 2000 SVS is converted if INGEST-014 (JPEG 2000 performance decision) finds that browser decoding misses the VIEW-040 budgets. INGEST-014 has not measured that yet. POC doc 32 measured the target: JPEG q90 chunks with all three channels in one chunk are 4.5 times smaller than zlib at 36.3 dB, and 16-bit fluorescence must stay 16-bit so contrast changes stay on the client.

## Options considered

1. Triggers as a registry in code, each tied to the ADR that fires it, with nothing fired by default. The converter refuses to run without a fired trigger.
2. Convert whatever no native reader opens. ADR 0043 rule 6 refuses those files instead, so this would reverse a recorded decision.
3. Target layouts: Zarr 3 sharded or unsharded. Sharding with range coalescing was faster at 200 ms in POC doc 32, but JPEG in a sharded store was never measured there, and VIEW-017 reads both. Unsharded keeps one chunk per tile and needs no shard index.

## Decision

- Option 1. `parfocal_ingest.conversion.Trigger` lists the triggers. Today it holds only `jpeg2000-decode-budget`, which applies to a slide whose finest level is JPEG 2000. `FIRED` is empty: no trigger has fired, so no slide is converted in the app. INGEST-014 fires it, if its numbers say so, by adding it to `FIRED` in the same change as its ADR. Any further trigger needs its own ADR line here or in a later record.
- `convert` raises `NotTriggeredError` unless its trigger is fired. It is not wired into the ingest workflow until a trigger fires.
- The store is OME-Zarr 0.5 on Zarr 3, unsharded, axes `c`, `y`, `x`, with the NGFF metadata under `attributes.ome` and the scale from the source's microns per pixel.
- 8-bit RGB becomes one JPEG chunk of shape `[3, 512, 512]` per tile, quality 90, 4:4:4 chroma, baseline, codec `imagecodecs_jpeg` after `bytes`, fill 255, as ADR 0305 reads it. 4:4:4 keeps the browser decoder in agreement with the script decoder.
- Anything else, 16-bit or not three channels, becomes lossless zstd at level 3 after little-endian `bytes`, with `omero` windows at the 0.5th and 99.8th percentiles of the coarsest level, as the POC did.
- Level 0 comes from the reader of record (OpenSlide or tifffile) chunk by chunk into a memory-mapped file on the worker's disk. Each next level is the 2 by 2 mean of the one before, down to one chunk, so the ladder is exactly 2, 4, 8 and passes INGEST-006 (pyramid and level validation) unchanged. Edge chunks are padded to the full chunk size.
- The store is written beside its final name and renamed when complete, and the work files are removed.

## Consequences

- Converted stores pass `zarr_tile_index` and the INGEST-006 ladder. The INGEST-009 (seams and correctness) comparison is done in Python against the source reader at two levels across chunk corners. The synthetics stay within its 1.0 mean error. JPEG 2000 tissue at quality 90 loses about 5 grey levels on its most textured corner, so the real slide is held to 30 dB PSNR, and every store must beat each 1 or 2 px shift and a channel swap by at least 2 times ([result](../results/2026-11-14-conversion-to-ome-zarr.md)).
- Two converted synthetic stores are committed and drawn by the Viv golden suite, and a test fails when they drift from a fresh conversion.
- Converting `JP2K-33003-1.svs` took about 27 s on a laptop. The time and cost per slide on Modal are TODO until a trigger fires.
- Glass chunks are written, not left absent. Skipping them through INGEST-008 (absence map) is a follow-up if storage matters.
- Sharding the converted store is a follow-up with its own measurement.
- TODO for the owner: no trigger exists for 16-bit or fluorescence slides. They are read natively today, so the zstd path waits for a trigger to be recorded.
