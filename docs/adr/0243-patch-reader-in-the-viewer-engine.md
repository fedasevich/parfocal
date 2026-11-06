# 0243. Patch reader in the viewer engine

- Date: 2026-11-06
- Status: Accepted
- Deciders: Claude
- Backlog: AISEG-015

## Context

The one-click annotation tools (smart select, hover preview, auto region and typing) need RGB patches of the slide as model input. Viv draws tiles into GPU memory and cannot hand pixels back, so a patch needs its own read. The patch must cover 128 microns whatever the scanner, which the scale presets of AISEG-012 (a preset maps to model microns per pixel) already settle.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| Reader in `apps/web` beside the presets | Next to the presets and the tools | Needs a worker file in the web app that imports the whole engine index, and the decode worker pattern is in the engine |
| Reader in the viewer engine, thin preset wrapper in `apps/web` | Reuses the pixel sources, byte relay, range cache and worker pattern of the decode pool. The same network cache serves the viewer and the patches | The engine knows patches by level and pixel size, and the web wrapper maps presets onto them |

## Decision

The reader lives in `packages/viewer-engine/src/patch/`. It reads a square window at a given level through `PixelSource.getRaster`, so every format the engine opens (SVS, generic TIFF, OME-TIFF, OME-Zarr and later NDPI) works with no format code. A worker runs it, reached through the same byte relay as the decode workers.

- The window is centred on the click and clamped to the level. A cached patch is kept for a click inside it, except within an eighth of the patch from an edge, where the patch moves and is recentred on the click. A side that sits on the slide edge needs no margin.
- Patches go in a least recently used cache of eight, keyed by level and window, so moving back to an earlier patch costs no read. Concurrent reads of one window share one slide read.
- A window the source reports as absent (a sparse region) comes back flagged `absent` with no pixels, and the answer is cached.
- Pixels come back as interleaved 8-bit RGB. A grey plane repeats into all three channels. Slides above 8 bits are refused until a task decides how to window them.
- `apps/web/src/aiseg/patch-reader.ts` turns a preset and a level 0 point into a level, a size in pixels and a width in microns with the AISEG-012 planner.

## Consequences

- Hamamatsu NDPI has no registered pixel source until VIEW-013 (native NDPI reader). The SVS, generic TIFF and OME-Zarr tests run now, the NDPI fixture test skips itself until that format is registered and then runs unchanged, and an NDPI-shaped ladder test covers the level choice meanwhile.
- A patch is a second read of bytes the viewer may also fetch. The shared range cache keeps the duplicate off the network.
