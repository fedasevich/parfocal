# 0316. JPEG 2000 slides stay native, and the decode budget trigger has not fired

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: INGEST-014 (JPEG 2000 performance decision). Closes the open measurement of [ADR 0111](0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md) (JPEG 2000 in the decode workers) and settles the only trigger of [ADR 0306](0306-conversion-triggers-and-the-ome-zarr-target.md) (conversion triggers and the OME-Zarr target).

## Context

Aperio JPEG 2000 slides (compression 33003 and 33005) decode in the decode workers through OpenJPEG WebAssembly. ADR 0306 holds one conversion trigger, `jpeg2000-decode-budget`, which fires if that decoding misses the VIEW-040 (viewer performance budgets) limits. [ADR 0310](0310-converted-jpeg-2000-slides-are-lossless-and-keep-the-source-levels.md) (converted JPEG 2000 slides are lossless and keep the source levels) made the cost of firing it clear: a converted slide is 11.6 times its source, so 100 slides of 1 GB would cost about $17 a month of a $30 budget.

VIEW-040 is not finished. The limits that exist are in `perf-budgets.json` for the JPEG slide `CMU-1.svs` at 200 ms RTT: 6,300 ms to the fitted image and 5,390 ms to sharp after a jump. The pan frame budget has no limit yet.

## Options considered

1. Keep JPEG 2000 native and leave the trigger unfired.
2. Fire the trigger and convert every JPEG 2000 slide to lossless OME-Zarr.
3. Keep it native but first add a faster path: more workers, decoding fewer wavelet levels for views between two stored levels, or a decoded tile cache.
4. Convert to HTJ2K instead of zstd. No HTJ2K decoder or slide is in the repository, and it was not measured.

## Decision

Option 1. The pass rule was fixed before the run and all three parts hold on the hardware GPU of an Apple M4 in headed Chrome ([result](../results/2026-11-15-jpeg-2000-browser-decode-cost.md)).

| Rule | Limit | JPEG 2000, worst of two slides | JPEG, same session |
|---|---|---|---|
| Fitted image at 200 ms RTT | 6,300 ms | 3,377 ms | 3,517 ms |
| Sharp after a jump at 200 ms RTT, every view | 5,390 ms | 2,739 ms | 2,940 ms |
| Sharp after a jump with no network delay | 1.5 times JPEG | 525 ms, 0.92 times | 569 ms |
| Pan frame p95 at 60 Hz | within 1 ms of JPEG, no frame over 33.4 ms | 18.4 ms, worst frame 18.6 ms | 18.3 ms, worst frame 18.7 ms |

- Tile decode in a worker is 2.5 ms at p50 and 3.0 ms at p95 for 33005, and 5.5 and 5.9 ms for 33003. Through the worker pipeline a JPEG 2000 tile reaches the page in 7.3 to 10.6 ms at p50 and 9.1 to 12.0 ms at p95, against 10.0 and 12.1 ms for a JPEG tile.
- `FIRED` in `parfocal_ingest.conversion` stays empty. No slide is converted in the app, and the converter stays unwired from the ingest workflow.
- The trigger stays in the registry. It may be fired only by a new record with a new measurement that fails the same rule, for example on a slower reference machine or a slide class not covered here.
- Six decode workers stay the default. The worker sweep showed no need to change it for JPEG 2000.
- HTJ2K is not adopted as a conversion target. It would be considered only if the trigger fires.

## Consequences

- A JPEG 2000 slide costs its own size in storage and nothing in conversion compute, which keeps risk R2 (JPEG 2000 SVS decodes too slowly in the browser) closed without spend.
- The first JPEG 2000 tile of a session costs about 30 ms more than a JPEG tile, once per worker, for the WebAssembly module.
- The measurement is one fast laptop and two Aperio slides. A CPU three times slower was estimated, not measured, to keep over 100 tiles a second. TODO: repeat on a slower machine and on a larger slide before the first real user.
- A fix is in hand if that repeat fails: the OpenJPEG build already exposes `decodeSubResolution`, which was 2.4 to 6.7 times faster in the codec timing and fits views that sit between two stored levels. It needs its output checked and is not built.
- `pnpm --filter @parfocal/viewer-engine bench:j2k` repeats the run. It is headed, needs the `formats` fixture group and is not part of CI.
- The lossless converter of INGEST-015 (conversion fallback worker) stays as tested code with no caller.
