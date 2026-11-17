# Result: a located slide open now reads its directories, tile tables and first tile in two rounds after levels.json

- Date: 2026-11-17
- Backlog: TILES-012 (the slide's ranges arrive in two rounds after levels.json)
- Kind: the engine's latency proxy test on the owner's Mac. No deployed "after"
- Commit: the TILES-012 branch, `perf(TILES-012): ...`
- Environment: `packages/viewer-engine/test/access/located-levels.test.ts`, Node's fetch through `@parfocal/latency-proxy` at 100 ms round trip, fastest of three opens

## Question

TILES-011 (a slide opens in under 3 s from navigation) found that a located open still made five rounds after levels.json: the TIFF header, the directories, a re-read of the last directory, the tile byte count arrays and the first tile. Can that come down to at most three?

## Why there were five rounds

- geotiff's `fromSource` reads the first 1,024 bytes for the byte order, the BigTIFF flag and the first directory offset.
- `parseFileDirectoryAt` reads 4,048 bytes (1,024 for classic TIFF) and reads again when the slice does not hold `entries × 36` bytes. The last directory sits near the end of the file, so its first read comes back short and it reads again.
- The tile byte count and tile offset arrays sit outside the directory and are read only once the directory is parsed.

## Change

- Ingest writes `littleEndian` and `bigTiff` into levels.json, and with each directory its `valueRanges`, the `[tag, offset, length]` of every value outside the directory that the open reads: BitsPerSample, TileOffsets, TileByteCounts, ExtraSamples, SampleFormat and JPEGTables. NDPI directories get none, because the NDPI source reads them its own way.
- When every directory has a size and value ranges, the engine builds the GeoTIFF from those header facts without reading the header. It asks at once for each directory (twice its size, at least the parser's slice) and every value range, except a TileOffsets array over 64 KB, and the parser reads those bytes from memory. A slice that came back short at the end of the file answers the parser's second read too, so the re-read is gone. Anything else still goes to the network.
- `backfill_level_directories` now treats a table without the header facts as out of date, reads each directory's whole entry table from the store and writes the new fields. Remote-storage slides get the header facts only, because the backfill cannot read their bytes.

## Numbers, fastest of three, 100 ms round trip

| Fixture | Walk the chain | Offsets only (TILES-010) | Primed (TILES-012) |
|---|---|---|---|
| Spread BigTIFF, 11 directories | 1,698 ms, 15 rounds, 19 requests | 642 ms, 5 rounds, 19 requests | 232 ms, 1 round, 14 requests |
| Philips-style classic TIFF, 4 directories, XML description of about 240 KB | 844 ms, 7 rounds, 8 requests | 528 ms, 4 rounds, 8 requests | 319 ms, 2 rounds, 4 requests |

Rounds count the longest chain of reads after levels.json in which each read starts after the one before it ended. In the spread BigTIFF the smallest level's single tile lies inside the primed bytes of the directory before it, so its first tile needs no read of its own. In the Philips fixture the first tile is the second round. No range is read twice, and no read takes more than one parser slice of the XML description.

At the roughly 400 ms a round took deployed, three fewer rounds should save about 1.2 s after levels.json. That is inferred from the owner's numbers, not measured.

## Deployed follow-up: test_065 still walked the chain

After v0.13.4 and a `backfill_level_directories` run, test_065 still opened with 10 strictly serial ranges after levels.json. Its `samples/camelyon16/test_065/levels.json` in parfocal-dev-eu (1,731 bytes, about 400 gzipped, matching the 709 bytes transferred with headers) had no `ifdOffset`, `littleEndian` or `bigTiff`, so the engine rightly walked the chain. The folder was made by hand for FOUND-040 (the edge Worker and the dev bucket under make dev) and holds only `original.tif`, `levels.json` and `restricted-ranges.json`. The backfill needs `tile-index.json` to know which directory belongs to which level, so it skipped this slide silently, both for TILES-010 and TILES-012.

The backfill now builds the tile index from the stored original through ranged reads when `tile-index.json` is missing (tifffile over `RangedFile`, any TIFF-family format, Philips included), writes the table only when every level's size matches, and counts that outcome as `stored-from-original`. The Modal function now returns the counts instead of None. It does not store the derived tile index.

On the local copy of test_065 (a Philips BigTIFF, 9 levels, level 0's TileOffsets and TileByteCounts 127,680 bytes each) the table the backfill writes equals the one the test's own directory walker makes. The latency proxy test, which now includes test_065 when the fixture is downloaded, at 100 ms round trip, fastest of three:

| Fixture | Walk the chain | Offsets only | Primed |
|---|---|---|---|
| CAMELYON16 test_065 | 1,812 ms, 16 rounds, 19 requests | 663 ms, 5 rounds, 19 requests | 348 ms, 2 rounds, 12 requests |

The backfill must run again on Modal main after the next deploy for test_065 to take the primed path.

## Not covered

- The deployed open. TODO after the next deploy and a second `backfill_level_directories` run: the owner's browser waterfall of test_065 from a fresh navigation.
- A real Philips slide. The fixture is uncompressed and has no JPEGTables, and a real one may place its directories elsewhere in the file.
