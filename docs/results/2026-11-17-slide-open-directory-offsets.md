# Result: with the directory offsets in levels.json a TIFF slide opens in about a third of the time at 100 ms per round trip, and tile-access runs 7 queries instead of 10

- Date: 2026-11-17
- Backlog: TILES-010 (a slide opens in under 3 s: the directory offsets come with levels.json)
- Kind: local engine runs with a simulated round trip, and local API tests on the compose Postgres. No deployed "after" yet
- Commit: the TILES-010 branch, `perf(TILES-010): ...` commits
- Environment: the owner's Mac, Node 26, the cached vendor fixtures in `~/.cache/parfocal/fixtures`, the compose Postgres and storage

## Question

OPS-033 (home under 500 ms and a slide opens in under 3 s) measured test_065 on the deployed app: tile-access 0.8 to 1.1 s, levels.json 0.29 s, then 9 TIFF directory blocks read one after another, 2.6 s warm and 4.8 s cold. How much do the offsets in levels.json, the early grant and a leaner tile-access save?

## Change

- Ingest writes `page`, `subIfd`, `ifdOffset`, `ifdBytes` and `siblings` on every level of levels.json for every TIFF-family slide, from the tile index it already builds. `ifdBytes` is the directory's entry table (count, entries and next pointer).
- `parseLevelTable` carries them into the slide index when every level has them, so `indexedPages` parses all directories at once. An old table, a zipped upload or a non-TIFF format keeps the chain walk.
- `backfill_level_directories`, a new Modal function, adds them to the stored levels.json of every slide that has a tile index, reading only the directory heads of the original by range. Not run.
- The slide stage asks for tile access before the viewer code finishes loading.
- tile-access reads its two storage objects while it checks access and writes the audit row. `project_grant` reads liveness and role in one query, and the audit pseudonym of a known person in one query.

## Signed open, walk against located levels.json

`scratch-located-compare.ts` (kept in the session scratchpad, not committed) opens each fixture through `signedOpenRequest` and the default registry, once with the old table and once with the located one, waiting 100 ms before every request to stand in for a round trip. Fastest is not taken, these are single runs. "Same" compares every level's shape and the middle tile of every level byte for byte.

| Fixture | Same | Walk open (ms) | Walk requests | Located open (ms) | Located requests | First tile, walk then located (ms) |
|---|---|---|---|---|---|---|
| test_065.tif (Philips) | yes | 1,691 | 18 | 539 | 18 | 1,824, 680 |
| Philips-4.tiff | yes | 1,782 | 19 | 528 | 18 | 1,911, 655 |
| OS-1.bif | yes | 2,042 | 21 | 641 | 19 | 2,228, 815 |
| CMU-1.svs | yes | 1,365 | 15 | 527 | 11 | 1,503, 642 |
| Leica-1.scn | yes | 1,150 | 11 | 423 | 8 | 1,276, 547 |

With no delay every one of CMU-1.svs, CMU-1-JP2K-33005.svs, CMU-1.tiff, Leica-1.scn, Huron-1-40x.tif, Philips-3.tiff, Philips-4.tiff, test_065.tif, tumor_009.tif, Argos-1.avs, CMU-1.ndpi and OS-1.ndpi drew the same pixels both ways. Argos-1-Stacked.avs did not: the old table names levels by stored size, so the signed open took the first plane of the stack, while ingest, the thumbnail and an unsigned open take the focused plane 2. The located table names the focused plane's pages, so it now matches them.

`located-levels.test.ts` pins the same on a spread BigTIFF of 11 directories through the latency proxy at 100 ms: walk 1,685 ms in 19 requests, located 660 ms in 19 requests.

## tile-access

`test_tile_access.py` reads Server-Timing on the compose Postgres. The test harness skips the session check, so these are the handler's own queries.

| | Queries | Transactions |
|---|---|---|
| Before | 10 | 1 |
| After, warm | 7 | 1 |

The three gone are the second liveness and role read (now one query, twice) and the audit pseudonym insert of a person already known. On a fast container OPS-033 measured 15 to 25 ms per query, so about 50 to 75 ms less, an estimate, not measured. The R2 read of the restricted ranges and the HEAD of the original now overlap the checks instead of following them. Not measured deployed.

## What this means

On test_065 the deployed walk was 2.6 to 4.8 s for 9 blocks. With the offsets the directories are one round of parallel reads, and the local run at 100 ms per request cut the open from 1.7 s to 0.5 s. The deployed number waits for the lead's deploy and the backfill run.

## Not covered

- TODO after the deploy: run `modal run -e main parfocal_deploy.modal_app::backfill_level_directories` (it rewrites levels.json objects in the slide bucket, which the edge caches for up to 10 minutes), then time test_065's open in a browser and tile-access with Server-Timing.
- The browser's own waterfall and the time the early grant saves while the viewer code loads.
