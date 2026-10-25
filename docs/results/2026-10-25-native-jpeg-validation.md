# Result: native JPEG decode validated per file against the script decoder

- Date: 2026-10-25
- Backlog: VIEW-005 (native JPEG decode with per-file validation), VIEW-006 (shared decode cache across channels)
- Kind: benchmark
- Commit: adc94fc plus uncommitted changes in the worktree (`packages/viewer-engine/src/pixel-source/tiff/native-jpeg.ts` and its callers)
- Environment: Apple M4, macOS 15.8.1, Chrome 155.0.8059.86 headless (SwiftShader flags, which do not affect JPEG decode), Node v26.9.0
- Data: the cached OpenSlide, Huron, Argos and CAMELYON16 fixtures in `~/.cache/parfocal/fixtures`. No PHI.

## Question

Does `createImageBitmap` decode the TIFF JPEG tiles of each fixture the way geotiff's JavaScript decoder does, which fixtures fail the check, and is the browser decoder usable inside the decode workers. The POC number to compare against is a mean absolute error of 47.7 out of 255 on an Aperio SVS file ([POC doc 06](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/06-engineering-notes.md)).

## Method

- `pnpm --filter @parfocal/viewer-engine exec playwright test native-jpeg` runs `browser/native-jpeg.spec.ts` against the harness page `browser/page/native-jpeg-harness.ts`.
- For each fixture the harness opens a source with the native decoder allowed and one with it off. It reads one window of 16 tiles (1024 by 1024) or 64 tiles (2048 by 2048) near the middle of level 0 from both and takes the mean absolute error over all three channels. Times are the faster of two reads.
- The validation probe inside the source picks, from up to 24 present whole tiles per distinct `JPEGTables` value, the tile with the most compressed bytes. It decodes it natively and with geotiff and accepts the native decoder only when the mean absolute error is at most 3.
- The same fixtures are opened in a real decode worker (`createWorkerRegionReader` with one worker), which runs the same probe. A tiny worker created from a blob reports whether `createImageBitmap` and `OffscreenCanvas` exist there.
- The POC's own probe tile (the middle tile index, skipping absent tiles) is read on CMU-1.svs through `middleTileError` to compare with the POC number.

## Results

| Fixture | Decision | Probe error | Window error | Native ms | Script ms | Window |
|---|---|---:|---:|---:|---:|---|
| CMU-1.svs | script (disagreed) | 54.12 | - | - | 50.0 | 1024 x 1024 |
| CMU-2.svs | script (disagreed) | 60.25 | - | - | 50.2 | 1024 x 1024 |
| CMU-1-Small-Region.svs | script (disagreed) | 49.43 | - | - | 59.5 | 960 x 960 |
| Huron-1-40x.tif | script (disagreed) | 5.44 | - | - | 66.1 | 1024 x 1024 |
| CMU-1.tiff | native (agreed) | 1.50 | 0.03 | 6.7 | 48.4 | 1024 x 1024 |
| Philips-3.tiff | native (agreed) | 2.25 | 1.85 | 16.7 | 240.0 | 2048 x 2048 |
| Philips-4.tiff | native (agreed) | 1.47 | not read, window absent | - | - | 2048 x 2048 |
| Argos-1.avs | native (agreed) | 1.96 | 0.31 | 14.2 | 207.2 | 2048 x 2048 |
| Leica-1.scn | native (agreed) | 1.20 | 1.12 | 16.6 | 253.5 | 2048 x 2048 |
| test_001.tif | native (agreed) | 2.02 | 0.29 | 17.6 | 220.3 | 2048 x 2048 |
| tumor_009.tif | native (agreed) | 1.08 | 0.43 | 17.3 | 213.5 | 2048 x 2048 |
| Huron-1-Uncompressed.tif | none (not JPEG) | - | - | - | 23.6 | 1024 x 1024 |

- The POC's probe tile of CMU-1.svs gave a mean absolute error of 47.69 here, which reproduces the POC's 47.7.
- The decode worker reached the same decision and the same probe error as the page for every fixture. `createImageBitmap` and `OffscreenCanvas` exist in a dedicated worker in Chrome 155.
- Probing in the page and in six workers added about one 1 MiB block to the open of CMU-1.svs. The pan test now counts 48 fetches and 49.6 MB over open, outbound and back legs with 0 duplicate bytes, against 45 to 47 fetches and 48.6 MB in the [earlier pan result](2026-10-23-decode-pool-pan-fetches.md).
- The existing CMU-1.svs goldens (fitted, 10x and 40x) are unchanged and still pass, because the workers fall back to the script decoder. A route forced to trust the native decoder on CMU-1.svs fails all three.

## Interpretation

- Facts: all three Aperio SVS files fail the check by 49 to 60 levels, far from the 3 level threshold. Every file that passes sits between 1.08 and 2.25.
- The probe error depends on the tile. The POC's tile gave 47.69 and the tissue-rich tile chosen here gave 54.12 on the same file, so a file that is only wrong on some tiles is more likely to be caught by the richer tile.
- Huron-1-40x.tif fails at 5.44 with no earlier measurement. It stays on the script decoder. Whether it is a real splice problem or only stronger chroma upsampling differences is not known, TODO: look at its JPEG headers if its decode speed matters.
- Assumption: the 3 level threshold is the POC's. The data here has a gap from 5.44 to 49.43 with only Huron inside it, so the threshold has been tested on a small corpus.
- The native decode is 7 to 15 times faster than the script decoder on the same window in the page (6.7 against 48.4 ms for CMU-1.tiff, 16.6 against 253.5 ms for Leica-1.scn). The script time includes geotiff's own tile fetch from the byte cache. These are single-page numbers and not decode worker numbers.

## Follow-ups

- [ADR 0110](../adr/0110-native-jpeg-decode-and-tissue-fit.md) records the rule.
- TODO: confirm the cause of the Aperio failure (the 289 byte `JPEGTables` without Huffman tables in the POC's account) and whether a corrected splice would let SVS files use the native decoder.
- TODO: measure the pan latency through six workers with native decode on a native-eligible fixture. This run measured single-window decode only.
