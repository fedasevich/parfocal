# Result: viewer engine review of 2026-11-09

- Date: 2026-11-09
- Backlog: VIEW-059 (no black edge row on virtual levels), VIEW-060 (a decode worker that fails to start), VIEW-061 (no decode workers left behind), VIEW-062 (grey slides through the channel route), VIEW-063 (sharded OME-Zarr), VIEW-064 (failed tiles on multichannel slides), VIEW-065 (short 206 reply) and VIEW-066 (three suspicions)
- Kind: check
- Commit: ba45feb5
- Environment: the owner's Mac, read-only
- Data: `packages/viewer-engine`

## Question

Where does the viewer engine draw wrong pixels, hang or leak, and would the tests notice.

## Method

A read-only review by an agent. Nothing in the repository was run. Each finding becomes a fix only after a failing test reproduces it.

Read only. Nothing was run, so every number below comes from reading the code and from hand arithmetic. Paths are relative to the repository root. Line numbers are as of the read on 2026-11-09, and `apps/web/src/viewer/slide-stage.tsx` was being edited by another session at the time.

Counts: 6 confirmed findings (5 medium, 1 low) and 4 suspicions (1 medium, 3 low).

## Confirmed findings

I traced each of these through the code, including the library code in `node_modules` where it matters.

### 1. Medium. Black last row or column on virtual levels whose backing level is stored one pixel short

The code is in `packages/viewer-engine/src/viv/viv-levels.ts`, lines 160 to 172 (`boxDownsampleToInterleaved`) and 251 to 258 (`plan`). The same arithmetic is in `boxDownsamplePlane` and in `readRegion` in `packages/viewer-engine/src/viv/viv-channel-levels.ts` (about lines 103 to 150 and 203 to 212).

`virtualLadder` gives each virtual level the size `ceil(base / downsample)`. `plan` clamps the read window to the backing level but keeps the output size at `x1 - x0` by `y1 - y0`. When the backing level holds fewer rows than the output needs, the last output row averages zero samples. `count` is 0, `(2 * sum + count) / (2 * count)` is NaN, and the `Uint8Array` stores 0.

Trigger: CMU-1.svs, base 46000 by 32914, levels 11500 by 8228 and 2875 by 2057. Aperio stores the floor (32914 / 4 = 8228.5), and `recoverLadder` in `pixel-source/geometry.ts` keeps `min(stored, ceil)`, which is 8228. The 4x virtual level is 8229 rows on a backing of 8228 rows at residual 1. The 8x level is 4115 rows and needs 8230 backing rows at residual 2. The 16x level is 2058 rows on a backing of 2057. Each of those three levels gets one black row along the whole bottom edge, drawn over the last real slide rows, with no error. Viv 0.23 places a tile by its returned `data.width` and `data.height` (`renderSubLayers` in `@vivjs/layers/dist/index.mjs`, lines 849 to 854), so the row is on screen. Any slide whose level sizes are floors of an odd quotient does the same on the right or bottom edge, RGB or multichannel.

That trace is for an open without a slide index. An indexed open (`chooseLevels` in `pixel-source/tiff/tiff-source.ts`, lines 197 to 204) takes each level's width and height from `levels.json`, so it gives the same black row whenever ingest writes the stored size of 8228. I did not check what ingest writes.

A second form of the same bug: when the virtual width is one more than a multiple of the tile size and the backing level is the floor, the last tile column has `x0 * residual === backing.width`. The window is empty, `checkWindow` throws a RangeError, and that one-pixel column of tiles fails on every load.

The tests miss it because `test/viv/viv-levels.test.ts` only downsamples sources that cover the output ("averages each block per channel and keeps short edge blocks" uses 3 by 2 into 2 by 1 at residual 2) and the CMU-1 case checks ladder sizes only, never the pixels of a bottom tile.

Failing test, in `test/viv/viv-levels.test.ts`: `boxDownsampleToInterleaved([r, g, b], 2, 1, 1, 2, 2)` with every sample 200 must return no 0. Then `createVivLevels` over a fake source with levels 46000 by 32914 at 1 and 11500 by 8228 at 4, a `read` stub that returns the clamped window filled with 200, and `levels[2].getTile` for the bottom row must have a last row of 200.

Smallest fix: in both downsample functions clamp the sampled block to the last valid row and column (`top = Math.min(y * residual, sourceHeight - 1)`, the same for `left`) so the edge sample is repeated, and in `plan` and the channel `readRegion` clamp the window start to `backing.width - 1` and `backing.height - 1` so the window is never empty.

### 2. Medium. A decode worker that never starts hangs its slot, its tiles and the whole stage, with no error

The code is in `packages/viewer-engine/src/decode/worker-reader.ts`, line 110. The only listener on a worker is `message`. `packages/viewer-engine/src/patch/worker-client.ts` (the `ready` promise, about lines 77 to 99) has the same gap.

Trigger: the worker script fails to load or throws while loading (a hashed chunk removed by a deploy while the tab stays open, an offline moment, a blocked script). The browser fires `error` on the `Worker` and no message ever arrives. `reader.ready` never settles, so `viv-route.ts` line 269 never reports it. The pool still dispatches regions to that slot (line 97 posts without waiting for the open). Those promises never settle, the slot never returns to `freeSlots`, and the entry stays in the pool's `entries` map, so a later request for the same region joins the dead entry. The tiles stay blank with no failed-tile placeholder. `pool.idle()` stays false, so `settled()` in `viv-route.ts` (line 408) stays false, `whenIdle()` never resolves, and `slide-stage.tsx` (lines 488 to 499) never sets the session. The stage shows "Loading the slide" for ever and the deck loop never sleeps. In the patch reader every `read` waits on `ready` and hangs.

The tests miss it because the fake workers in `test/decode/worker-reader.test.ts` always answer. A grep of that file finds no `error` event.

Failing test, in `test/decode/worker-reader.test.ts`: spawn fakes where worker 0 dispatches an `error` event and never posts. Expect `reader.ready` to reject, a `read` routed to slot 0 to reject, and `reader.idle()` to be true afterwards.

Smallest fix: add `error` and `messageerror` listeners per worker that reject its ready promise and every waiter posted to that worker (keep the slot with each waiting id), and make `run` reject at once for a slot marked dead. Do the same in `patch/worker-client.ts`.

### 3. Medium. A slide the RGB route cannot draw leaks its decode workers, and single-channel slides cannot be shown at all

The code is in `packages/viewer-engine/src/viv/viv-route.ts`, lines 342 to 376 (`showSlide`), with `packages/viewer-engine/src/engine/engine.ts`, lines 424 to 427.

`showSlide` calls `release()`, then `readerFor(slide)` (line 349, which spawns `decodeWorkers` workers, 6 by default, each opening the slide), and only then `createVivLevels` (line 356), which throws `UnsupportedVivSourceError` for anything but 8-bit, 3-channel RGB with a power-of-two ladder. Only `photometric === "channels"` goes to the channel route (line 351). `tiff-source.ts` line 140 and `ome-zarr-source.ts` line 159 both label a one-channel slide "grey".

Trigger: a one-sample BlackIsZero TIFF, a one-channel OME-Zarr, a 16-bit RGB TIFF, or any pyramid with a step that is not a power of two. The throw leaves the new reader unreferenced (`shown` is null), so nothing ever terminates its workers or closes their ports. The engine has already set `slide` and `slideInfo`, emits no `slide` event, and `openSlide` rejects. `slide-stage.tsx` shows the failure banner, and each press of "Try again" remounts and leaks another 6 workers. The grey case is also a plain display bug: `assertChannels` in `viv-channel-levels.ts` rejects only "rgb", so the channel route would draw it.

The tests miss it because `test/viv/viv-levels.test.ts` ("refuses sources that are not 8-bit RGB") checks only that `createVivLevels` throws. No test calls `showSlide` with such a source and a counting `spawnDecodeWorker`.

Failing test, in a new browser spec `packages/viewer-engine/browser/unsupported-slide.spec.ts` that reuses the harness in `browser/page/memory-route.ts`: mount the route with a `spawnDecodeWorker` that counts `terminate` calls, call `showSlide` with a grey fake source, and expect either a drawn slide or a throw with every spawned worker terminated.

Smallest fix: send every source whose photometric is not "rgb" to `channelShown`, and build the levels before `readerFor` (or dispose the reader in a `catch`) so a throw leaves nothing alive.

### 4. Medium. Sharded OME-Zarr cannot be read through the page byte cache or the worker relay

The code is in `packages/viewer-engine/src/pixel-source/zarr/ome-zarr-source.ts`, lines 240 to 246, and `packages/viewer-engine/src/decode/byte-relay.ts`, lines 30 to 33 (`cachedFetch`) and 53 to 63 (`relayFetch`).

zarrita 0.7.5 reads a shard index with `getRange(path, { suffixLength })` (`codecs/sharding.js` line 28). `FetchStore` in `@zarrita/storage` 0.2.0 answers that with a HEAD request unless `useSuffixRequest` is set, and then reads `Content-Length`. The source does not set the option. `cachedFetch` and `relayFetch` forward only the URL and the Range header, so the HEAD becomes a full GET of the shard file through `passThrough`. The rebuilt `Response` carries no `Content-Length`, so zarrita computes length 0 and asks for `bytes=-N--1`, which the range cache passes to the server unchanged.

Trigger: any OME-Zarr 0.5 store written with the sharding codec, opened by `createPixelSlideOpener` (always behind `cachedFetch`) or by a decode worker (always behind `relayFetch`). Every shard-index read downloads the whole shard and then sends an invalid range. A server that ignores the bad range returns the whole file as the index, which fails the checksum or yields wrong chunk offsets. A server that rejects it fails the tile.

The tests miss it because the sharded case in `test/pixel-source/conformance.test.ts` (line 352) opens with the default `fetch`, where HEAD works. No test opens a sharded store through `cachedFetch` or `relayFetch`.

Failing test, in `test/pixel-source/conformance.test.ts`: open the "OME-Zarr 0.5 RGB sharded" fixture with `fetch: cachedFetch(createRangeCache({ fetch: counting }))`, compare the pixels with the expected raster, and assert that no request without a Range header was made for a shard file.

Smallest fix: pass `useSuffixRequest: true` to `FetchStore`. The range cache already passes `bytes=-N` through untouched.

### 5. Medium. A failed tile on a multichannel slide stays blank with no placeholder, no retry and no error

The code is in `packages/viewer-engine/src/viv/viv-route.ts`, lines 332 to 337, and `packages/viewer-engine/src/viv/viv-channel-levels.ts`, about lines 219 to 233.

The RGB levels keep a `failed` map that feeds `failedTiles()`, the placeholders and `retryTile`. The channel levels keep none, and the route hard-codes `failures: () => []` and `loadState: () => idleLoadState` for channel slides.

Trigger: a fluorescence slide and one tile request that fails once (a 503 or a dropped connection). deck.gl counts the rejected tile as loaded. Both consumers pass their own `onTileError` (`slide-stage.tsx` line 469 passes a no-op), so nothing surfaces. The tile stays empty until deck evicts it, and the slow-load hint never shows for these slides.

The same catch block (about line 229) lacks the `DecodePoolDisposedError` mapping that `viv-levels.ts` line 305 has. A slide switch with channel tiles in flight therefore sends that error to `onTileError`. It is harmless today only because both consumers ignore tile errors.

The tests miss it because `test/viv/viv-channel-levels.test.ts` checks that bad requests reject (line 88) and never asks what the route can show afterwards.

Failing test, in `test/viv/viv-channel-levels.test.ts`: a `read` stub that rejects once, then `getTile`, then expect `failures()` to list that tile and to be empty after a successful retry. Add a case where the stub rejects with `DecodePoolDisposedError` and expect Viv's abort sentinel.

Smallest fix: move the failed-tile map of `createVivLevels` into a small shared helper, use it in `createVivChannelLevels`, wire `failures` and `clearFailure` through in `channelShown`, and map `DecodePoolDisposedError` to `vivSignalAborted` in the channel catch.

### 6. Low. A 206 reply shorter than the range asked for is cached as complete and padded with zeros

The code is in `packages/viewer-engine/src/decode/range-cache.ts`, in `fetchRun` and `ranged` (about lines 77 to 104 and 135 to 160).

`fetchRun` checks only the status and the start of `Content-Range`. It slices the body into blocks and remembers them, however short they are. `ranged` allocates `stop - start` bytes, copies what each block holds and answers 206 with a full `Content-Range`.

Trigger: an intermediary or an edge worker bug that returns fewer bytes than asked for, not at the end of the file, for example 524288 bytes for a 1 MiB block. The missing bytes read as zeros for as long as the block stays cached, which gives a corrupt JPEG tile or wrong tile offsets. I rate it low because a conforming server does not do this.

The tests miss it because `test/decode/range-cache.test.ts` covers the end-of-file clip and 416 only.

Failing test, in `test/decode/range-cache.test.ts`: a fake fetch that answers 206 with half the bytes and `bytes 0-524287/2097152`, then expect `get(url, "bytes=0-1048575")` to reject.

Smallest fix: in `fetchRun` compare `bytes.byteLength` with `min(run length, total - start)` and throw when it is shorter, so nothing is cached.

## Suspicions

I could not prove these without running something.

1. Medium. A decode worker whose overview-levels file fails to open has fewer levels than the page. `withOverviewLevelsIfIndexed` in `pixel-source/registry.ts` swallows any error from that open, and each of the 6 workers opens the slide on its own. One transient 5xx on that file at open would leave one worker rejecting every region whose backing level it lacks, so about one coarse tile in six fails for the whole session. A test in `test/decode/worker-reader.test.ts` with one worker whose fetch fails the overview file once would show it. The fix is to fail the worker's open instead of swallowing, or to retry.
2. Low. An OME-Zarr level with no declared scale gets `downsample: baseWidth / width` (`ome-zarr-source.ts` line 275), which is not snapped. A base width of 1001 with a level of 501 gives 1.998 and `virtualLadder` throws. A level of 500 gives 2.002, so every virtual level reads level 0 with a growing residual, and the overview reads the whole base level. I did not check whether `openRoot` accepts a store without scales. `axisIndex` in the same file also never checks that y comes before x.
3. Low. `createPatchReader` in `patch/patch-reader.ts` starts a shared in-flight read with the first caller's `AbortSignal`, so a second caller that joined it is rejected when the first aborts. The patch worker passes no signal, so this only bites a caller that uses the reader on the page directly, which I did not look for.
4. Low. `registry.ts` registers no reader for `hamamatsu-ndpi`, `ventana-bif`, `mirax` or `dicom`, while `access/signed-slide.ts` (lines 116 to 122) maps file names to those ids. If ingest hands such a slide to the viewer under its own id the open fails with `UnsupportedFormatError`. I did not check what ingest writes. The NDPI offset wrapping and BIF stitching paths were therefore not reviewable as live code.

## Not counted

Each brightness step in the RGB route builds a new `loader` array (`viv-route.ts` line 316), and Viv puts `loader` in `updateTriggers.getTileData`, so every visible tile is read and decoded again. The channel route avoids this with `stableChannelInputs`. I found no wrong pixel from it, so it is a cost and not a finding.

## Areas that read as sound

- Level to zoom mapping. deck.gl 9.4 picks `ceil(zoom)` for a non-geospatial view, `prefetch.ts` uses the same, and Viv places short edge tiles by their data size.
- TIFF source. I read the tile index injection into tags 324 and 325, the edge tile and absent tile handling (`paintAbsent`, a tile with byte count 0), the JPEG tables splice, the native JPEG probe against the script decoder, and the photometric layout (RGB, converted YCbCr, BlackIsZero samples). I found no wrong arithmetic there apart from finding 1 above (the black edge row).
- OME-Zarr source. Chunk reads go through zarrita with the abort signal passed on, a missing chunk becomes `AbsentChunkError` and is painted as glass, and c is checked to come before y and x.
- Deck sleep, GPU recovery and dispose order. The parked loop is cancelled on destroy, the context-loss guard removes its listeners, and `disposeDeck` follows the order the knowledge file records.
- Decode pool. Reply ids come from one counter per reader, each slide has its own pool, aborts remove queued entries, retained late results stop at 32, and disposal rejects every waiter.
- Range cache bounds. 100 blocks of 1 MiB with LRU eviction, failed block fetches are not cached, and a coalesced run is never longer than the range one caller asked for.
- Engine open and close. A newer `openSlide` aborts the older one, a dispose during an open is handled, and `closeCurrentSlide` clears the route before the next slide.
- Slide switch and destroy. `release` disposes the reader (pool, workers, ports), and `destroy` stops the guard, the pixel ratio observer, the deck and the sleep timer.
- Camera. `clampCamera` keeps the centre inside the slide, and zero-size viewports are guarded in `cameraBounds`, `areaCamera`, `fitIfPossible` and `flyTo`.
- Input. Drag to pinch and back, wheel during a drag, lost pointer capture, blur and the synthetic double click after touch all end in a consistent state. The Safari gesture listener and the wheel handler act on different events, so I found no double zoom by reading.
- Overlay. Indices are `Uint32Array` and deck.gl types an indexed attribute as uint32, so more than 65,535 vertices is fine. Holes are passed to earcut per polygon, outline rings are split at hole starts, and the layer cache is keyed by source identity and a generation that `invalidate` bumps. Float32 positions are exact up to 16,777,216 pixels, which no supported slide reaches.
- Nuclei paging, the seen-coverage bitset and its flush, and the tile token refresh with one retry on 401.

## Not read in depth

`viv/interpolation.ts`, `tile-fade.ts`, `tile-wait.ts`, `tissue-box.ts`, `deck-settings.ts`, `webgpu-errors.ts`, `camera/view-history.ts`, `camera/motion-predictor.ts`, `input/keyboard-pan.ts`, the smaller overlay files (labels, agreement, outline modes, draw style, object drawing, pin icons) and `nuclei/pfc.ts`, `cell-summary.ts` and `cell-edits.ts` were skimmed or skipped. Test files were grepped, not read. BigTIFF, byte order and strip handling live in geotiff 3.0.5, which I did not audit beyond what the two knowledge files record.
