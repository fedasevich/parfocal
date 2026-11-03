# XXXX. Ingest writes the missing coarse power-of-two levels as a lossless TIFF sidecar that the pixel source appends to the slide's levels

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: INGEST-013 (derived overview levels for ladder gaps). Builds on [ADR 0102](0102-viv-route-feeds-a-virtual-rgb-ladder.md) (the Viv route feeds a virtual power-of-two ladder)

## Context

Viv's `MultiscaleImageLayer` needs loader entry `i` to be exactly a `2^i` downsample, so ADR 0102 (the Viv route's virtual ladder) built a virtual ladder whose entries read the finest real level not finer than them and box-average by the residual. Aperio stores 1x, 4x and 16x, so the coarse virtual levels of `CMU-1.svs` average the 16x level by up to 16 in each direction, and one coarse tile reads 256 tiles' worth of pixels. The POC measured 19 to 85 times the cost of a slide with a complete ladder (POC doc 05, findings). INGEST-013 (derived overview levels for ladder gaps) asks for the coarse reads to come within twice a full ladder.

## Options considered

Where the coarse levels come from:

1. Keep averaging in the browser and cache the averaged tiles. Nothing stored, but the first visit to every slide still pays the full cost on every coarse tile, and every viewer pays it again.
2. Convert the whole slide to a complete pyramid at ingest. Fixes every gap, including the 2x and 8x steps between stored levels, but doubles storage for gigapixel slides and is the conversion the project avoids until an ADR-recorded trigger fires.
3. Write only the levels coarser than the coarsest stored level, averaged once at ingest from that level, as a small sidecar next to the original. The in-between steps keep their residual of 2.

The sidecar format:

1. One JPEG or PNG per level. Simple, but a level is read whole and the browser needs a second image path next to the PixelSource.
2. An OME-Zarr group. Tile-addressable, but many small objects per slide and a second reader on the coarse path.
3. A tiled TIFF with one page per level, read by the existing `openTiffSource` as a generic TIFF. JPEG tiles would be smallest, but tifffile needs `imagecodecs` to write them. Deflate with the horizontal predictor needs nothing new and keeps the averaged pixels exact.

How the browser uses it:

1. A second loader inside `createVivLevels`. Only the Viv RGB route would gain, and the decode workers, which reopen the slide from its `OpenRequest`, would not see it.
2. The tile index carries a reference, and `registry.open` composes the slide and the sidecar into one `PixelSource` whose levels are the vendor levels followed by the derived ones. Every route and the decode workers get it, and `virtualLadder` picks the derived levels with a residual of 1 without change.

## Decision

Source option 3, format option 3 and browser option 2.

- `parfocal_ingest.overview_levels` lists the missing downsamples from the coarsest stored level down to the step where both sides fit one viewer tile, using the same tile rule as `vivTileSize` (the square stored tile up to 1024, otherwise 512). It reads the coarsest level once, box-averages it by each residual with the browser's half-up rounding, and writes `overview-levels.tiff` with tiles of the viewer tile size. It skips multichannel and multi-plane slides, complete ladders, viewer tiles that are not a multiple of 16, and coarsest levels above 2^25 pixels.
- The `index` step stores the file under the slide prefix next to the original and adds `overviewLevels: { path, downsamples }` to `tile-index.json`. The path is relative to the slide URL. The index version stays 1, because the field is optional.
- `withOverviewLevels` in `packages/viewer-engine/src/pixel-source/overview-levels.ts` checks that each derived level is exactly `ceil(base / downsample)` and coarser than the slide's own levels. `registry.open` falls back to the slide alone when the sidecar cannot be opened or does not fit, so a missing sidecar never stops a slide from opening.

The [result](../results/2026-11-03-derived-overview-levels.md) has the numbers.

## Consequences

- The sidecar is 1.3 to 2.1 MB on the three affected OpenSlide slides and takes about 0.3 to 0.4 s to build.
- The 2x and 8x steps of an Aperio ladder still read four times the pixels. A task can extend the sidecar to small in-between levels if the frame budget at those zooms needs it.
- Whoever serves `tile-index.json` to the web app must serve `overview-levels.tiff` from the same folder as the original, or rewrite the path.
- The page and each decode worker open the sidecar on their own through the shared byte cache. If one of them fails to open it while the other succeeds, they disagree on the level count and the worker refuses the coarse reads. This needs a transient failure of one request and was not seen.
- The CMU-1.svs golden images open the slide without an index, so they do not change.
