# Result: derived overview levels bring coarse-zoom tile reads on Aperio slides from 25 to 45 times a full ladder to below it

- Date: 2026-11-03
- Backlog: INGEST-013 (derived overview levels for ladder gaps)
- Kind: benchmark
- Commit: the INGEST-013 commit (`feat(INGEST-013)`)
- Environment: MacBook, Apple M4, macOS 15 arm64, Node 26.13.0, Python 3.14 with openslide-bin 4, no browser. The browser reader `openTiffSource` runs in Node on the main thread with the script decoders (`nativeJpeg: "off"`), served from a local HTTP server
- Data: the public OpenSlide test slides `CMU-1.svs` (1x, 4x, 16x), `JP2K-33003-1.svs` (1x, 4x, 8x), `CMU-1-JP2K-33005.svs` (1x, 4x, 16x) and, as the complete ladder, `CMU-1.tiff` (1x to 256x). No PHI

## Question

POC doc 05 (findings) measured the coarsest Viv tile at 19 to 85 times the engine's own read on Aperio slides, because the virtual ladder of ADR 0102 (the Viv route's virtual power-of-two ladder) averages the 16x level by up to 16 for every coarse tile. Does a sidecar of derived levels bring that read within twice a slide with a complete ladder?

## Method

`python -m parfocal_ingest.overview_levels SLIDE OUT` writes the sidecar for one slide. `node --test test/pixel-source/overview-levels.test.ts` in `packages/viewer-engine` writes the sidecars into a temporary folder through `uv run`, opens each slide through `createDefaultPixelSourceRegistry().open` with and without an index that names the sidecar, builds `createVivLevels` on it and times `getTile({ x: 0, y: 0 })` of the coarsest virtual level. Each figure is the median of 3 reads, each on a freshly opened source, timed after the open. Pixels read is the area of the backing window the Viv level asked for, counted through the `read` option. Each sidecar case is also opened once through `cachedFetch(createRangeCache())`, the byte cache the app and the decode workers share, and must draw the same tile. The build time and size come from calling `overview_levels` on each slide once.

## Results

Coarsest virtual level, one tile.

| Slide | Ladder | Without sidecar | With sidecar | Pixels read without | Pixels read with |
|---|---|---:|---:|---:|---:|
| `CMU-1.tiff` | complete, 1x to 256x | 10.5 ms | not needed | 22,912 | not needed |
| `CMU-1.svs` | 1x 4x 16x | 475.8 ms | 6.2 ms | 5,913,875 | 23,220 |
| `JP2K-33003-1.svs` | 1x 4x 8x | 268.2 ms | 4.4 ms | 4,201,227 | 16,577 |
| `CMU-1-JP2K-33005.svs` | 1x 4x 16x | 370.8 ms | 5.6 ms | 5,908,125 | 23,220 |

Against the complete ladder of `CMU-1.tiff`.

| Slide | Time without | Time with | Pixels without | Pixels with |
|---|---:|---:|---:|---:|
| `CMU-1.svs` | 45.3x | 0.59x | 258x | 1.01x |
| `JP2K-33003-1.svs` | 25.5x | 0.42x | 183x | 0.72x |
| `CMU-1-JP2K-33005.svs` | 35.3x | 0.53x | 258x | 1.01x |

The sidecar.

| Slide | Derived downsamples | Tile | Bytes | Build time |
|---|---|---:|---:|---:|
| `CMU-1.svs` | 32, 64, 128, 256 | 256 | 1,345,461 | 302 ms |
| `JP2K-33003-1.svs` | 16, 32, 64, 128 | 256 | 2,118,487 | 320 ms |
| `CMU-1-JP2K-33005.svs` | 32, 64, 128, 256 | 240 | 1,729,022 | 429 ms |
| `CMU-1.tiff` | none, the ladder is complete | | | 0 ms |

The tile drawn with the sidecar differs from the tile averaged in the browser by a mean of less than 2 grey levels on all three slides, which the test asserts. The ingest test asserts that every derived page equals the box average of the coarsest level as OpenSlide reads it.

## Interpretation

The sidecar meets the "Done when" line of INGEST-013 (derived overview levels for ladder gaps): coarse reads drop from 25 to 45 times the complete ladder to 0.4 to 0.6 times it, and the pixels read from 183 to 258 times to 0.7 to 1.0 times. The sidecar tiles are faster than the complete ladder's because deflate decodes faster than the script JPEG decoder. That is an assumption from the codecs, not measured. The times are lower than the POC's 1780 to 10979 ms because the POC decoded each tile three times, which the interleaved route of ADR 0102 (the Viv route's virtual power-of-two ladder) no longer does.

Only the levels coarser than the coarsest stored level are derived. The 2x and 8x steps of an Aperio ladder still read four times the pixels and were not measured here.

## Follow-ups

- [ADR XXXX](../adr/XXXX-derived-overview-levels-sidecar.md) (ingest writes the missing coarse levels as a lossless TIFF sidecar).
- TODO: the web app does not yet open slides through a served `tile-index.json`. When it does, it must serve `overview-levels.tiff` from the folder of the original.
