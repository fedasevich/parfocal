# Result: JPEG 2000 in the decode workers

- Date: 2026-10-26
- Backlog: VIEW-011 (SVS JPEG 2000 through OpenJPEG WASM), VIEW-010 (generic tiled TIFF and SVS JPEG)
- Kind: baseline
- Commit: 03d8d64 plus uncommitted changes in the worktree `agent-a6e31ae6832e18fc3`
- Environment: MacBook with an Apple M4, macOS 15.8.1, Node v26.9.0, Google Chrome 155.0.8059.86 driven by Playwright 1.64 on SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`), local range-request server, no network shaping
- Data: `CMU-1-JP2K-33005.svs`, `JP2K-33003-1.svs`, `JP2K-33003-2.svs` from the OpenSlide test data, and the synthetic `synthetic-jp2k-33005.tiff`, `synthetic-jp2k-33003.tiff` and `synthetic-jp2k-damaged.tiff` (1024 by 768, 256 px tiles, 3 levels)

## Question

Does `@cornerstonejs/codec-openjpeg` in the decode workers return the colours OpenSlide returns, does a non-J2K slide avoid downloading it, and what does a damaged tile cost the picture? The POC number for the grey placeholder is 160 of 255.

## Method

1. Colour. A Node script opened each SVS through `openTiffSource`, read tiles through the source, and compared them with `openslide-python`'s `read_region` at the same level origin (`uv run --no-project --with openslide-python --with openslide-bin --with numpy --with pillow`). The script ran before the tests were written and the tests pin the OpenSlide means it printed.
2. Download. `browser/jpeg2000.spec.ts` opens a slide through `createWorkerRegionReader` with one decode worker, reads three tiles, then lists every request the page and its worker made through `page.on("request")`. A J2K slide is the positive control that shows the listing sees worker requests.
3. Bundle sizes come from `packages/viewer-engine/test-results/harness/assets` after the Vite build of `browser/global-setup.ts` with `worker.format: "es"`.
4. Frames. `render/viv-jpeg2000.spec.ts` renders `CMU-1-JP2K-33005.svs` at 10x over the tissue centre of `CMU-1.svs` and compares it with the `viv-cmu-1-svs-10x` golden with `compareFrames`.

## Results

Colour against OpenSlide, mean absolute error over all samples of the tile and the largest single difference.

| Slide | Level | Tile | Mean absolute error | Largest difference | Tile means (R, G, B) |
|---|---|---|---|---|---|
| JP2K-33003-1.svs | 0 | 40,12 | 0.484 | 2 | 203.3, 110.8, 148.8 |
| JP2K-33003-1.svs | 0 | 30,20 | 0.433 | 2 | 227.5, 225.8, 223.7 |
| JP2K-33003-1.svs | 0 | 10,10 | 0.401 | 2 | 241.7, 242.2, 239.9 |
| JP2K-33003-1.svs | 1 | 8,5 | 1.134 | 45 | 224.4, 223.8, 223.7 |
| JP2K-33003-1.svs | 2 | 3,2 | 0.983 | 47 | 230.7, 228.0, 228.8 |
| JP2K-33003-2.svs | 0 | 40,12 | 0.419 | 1 | 241.7, 244.0, 241.3 |
| JP2K-33003-2.svs | 0 | 30,20 | 0.424 | 2 | 242.5, 243.5, 241.2 |
| JP2K-33003-2.svs | 0 | 10,10 | 0.423 | 2 | 241.8, 244.1, 241.3 |
| JP2K-33003-2.svs | 1 | 8,5 | 0.439 | 7 | 242.0, 243.7, 241.6 |
| JP2K-33003-2.svs | 2 | 3,2 | 0.971 | 42 | 238.9, 232.0, 235.0 |
| CMU-1-JP2K-33005.svs | 0 | 40,12 | 0.000 | 0 | 246.0, 246.0, 246.0 |
| CMU-1-JP2K-33005.svs | 0 | 119,44 | 0.000 | 1 | 178.9, 140.1, 173.4 |
| CMU-1-JP2K-33005.svs | 0 | 100,60 | 0.000 | 0 | 246.0, 246.0, 246.0 |
| CMU-1-JP2K-33005.svs | 1 | 8,5 | 0.021 | 2 | 245.8, 245.8, 245.7 |
| CMU-1-JP2K-33005.svs | 2 | 3,2 | 0.052 | 6 | 246.0, 246.0, 246.0 |

OpenSlide's means for the stained tile of `JP2K-33003-1.svs` (level 0, tile 40,12) were 203.8, 110.3 and 148.9.

Requests after the first tile read, with the build's file names shortened.

| Slide | Requests for the decoder | WebAssembly requests |
|---|---|---|
| `synthetic-jp2k-33005.tiff` | `jpeg2000-decoder`, `basedecoder`, `openjpeg-glue`, `openjpeg-wasm-url`, `openjpegwasm_decode.wasm` | 1 |
| `synthetic-jpeg.tiff` | none | 0 |
| `synthetic-zlib.ome.tiff` | none | 0 |

Build output sizes.

| File | Bytes |
|---|---|
| `decode.worker` chunk | 114,009 |
| `openjpeg-glue` chunk | 28,400 |
| `openjpegwasm_decode.wasm` | 260,334 (85,793 gzipped) |
| `jpeg2000-decoder` chunk | 1,616 |

Damaged tiles in `synthetic-jp2k-damaged.tiff` (tile 1 has its first four bytes zeroed, tile 6 has its body overwritten).

| Tile | Marker | Result |
|---|---|---|
| 1 (no marker) | missing | every sample 160 |
| 6 (garbled body) | present | every sample 160, OpenJPEG threw |
| 2, 7, 8 | intact | equal to `synthetic-jp2k-33005.tiff` |
| half of a good codestream, its first 40 bytes, 0 bytes, 4096 bytes of 7 | | every sample 160 |

Frames.

| Comparison | Mean error R, G, B | Differing pixels |
|---|---|---|
| `CMU-1-JP2K-33005.svs` 10x against the `viv-cmu-1-svs-10x` golden of CMU-1.svs | 5.06, 4.26, 5.32 | 77.5% above 4 per channel |
| Each new golden against its own re-render on SwiftShader | 0 | 0 |

The damaged synthetic slide at the fit view drew between 10% and 20% of its pixels as exactly (160, 160, 160), and its intact copy drew under 1%. The two grey regions are the two damaged tiles.

## Interpretation

Facts. The decoded colours match OpenSlide to within 0.5 per sample at level 0 on every fixture and the codec's own YCbCr conversion is already applied, so a second `readRGB` would be wrong. The JPEG 2000 codec is one lazy chunk and one WebAssembly file, and the two non-J2K slides never request them. The page refuses a J2K tile.

Assumptions. The 45 and 47 level differences at the coarser levels of `JP2K-33003-1.svs` and `JP2K-33003-2.svs` appear on single tiles and are not explained. They could come from OpenSlide placing a coarse level at a non-integer origin while the source uses the stored level directly. TODO check with a window read at the level's own origin. The mean error of about 5 levels between CMU-1-JP2K-33005.svs and the JPEG slide comes from a different compression of the same tissue and one pixel of misregistration between the two files (46,000 by 32,893 against 46,000 by 32,914), so it is an upper bound on the colour difference and not a tolerance study. The `jpeg2000` tolerance row (maximum delta 6, 1% of pixels, mean error 1.5) is unchanged because the J2K goldens are compared with SwiftShader renders of the same code, where the error is 0. TODO measure the row on a hardware GPU with `GOLDEN_MEASURE=1` before it is tightened or loosened.

## Follow-ups

- [ADR 0111](../adr/0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md) records the decisions.
- TODO INGEST-014 (JPEG 2000 performance decision) still needs decode time per tile in a worker. Nothing here measured it.
- TODO the real J2K goldens skip in browser CI until a J2K slide joins the `viewer` fixture group (`CMU-1-JP2K-33005.svs` is 132,565,343 bytes). This is a question for the owner.
