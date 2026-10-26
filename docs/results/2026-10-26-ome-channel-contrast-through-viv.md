# Result: OME-TIFF channels through Viv's contrast limits

- Date: 2026-10-26
- Backlog: VIEW-012 (OME-TIFF 8-bit and 16-bit)
- Kind: baseline
- Commit: 03d8d64 plus uncommitted changes in the worktree `agent-a6e31ae6832e18fc3`
- Environment: MacBook with an Apple M4, macOS 15.8.1, Node v26.9.0, Google Chrome 155.0.8059.86 driven by Playwright 1.64 on SwiftShader, canvas 1280 by 720 at device pixel ratio 1
- Data: `synthetic-channels-uint8.ome.tiff` and `synthetic-channels-uint16.ome.tiff` (1024 by 768, three channels DAPI, FITC and TRITC stored as separate pages with two SubIFD levels each, zlib tiles)

## Question

Does a 16-bit channel stack reach the screen through Viv's own per-channel contrast limits, with the contrast limit scaling the sample range as Viv documents it? This is the data and layer path of VIEW-012. The display controls and the one-frame contrast timing of VIEW-018 are not measured.

## Method

`browser/channels.spec.ts` mounts a deck.gl `Deck` with a Viv `MultiscaleImageLayer` over `createVivChannelLevels(source)` with the props of `vivChannelLayerProps`, on the page thread. It draws the slide fitted to the canvas, screenshots the canvas and averages a 5 by 5 block of pixels at slide point (500, 100), where DAPI is a left to right ramp of 500 / 1023 \* 0.6 of full scale. Each row changes only the stated display setting, and the layer is replaced through `deck.setProps`.

## Results

Mean colour of the block (R, G, B). The expected blue of the unchanged display is 500 / 1023 \* 0.6 \* 255 = 74.8.

| Setting | 16-bit | 8-bit |
|---|---|---|
| Default limits (0 to full scale) | 128, 20, 74.8 | 128, 20, 74.8 |
| DAPI limit 0 to half scale | 128, 20, 149.6 | 128, 20, 149.6 |
| DAPI limit 20% to full scale | 128, 20, 29.8 | 128, 20, 29.8 |
| DAPI hidden | 128, 20, 0 | 128, 20, 0 |
| DAPI colour yellow (255, 255, 0) | 202.2, 94.72, 0 | 202.8, 94.8, 0 |

The conformance suite reads both files as three channels with the names and colours from the OME XML (DAPI blue, FITC green, TRITC red), three levels of 1024 by 768, 512 by 384 and 256 by 192, and 0.5 µm per pixel.

## Interpretation

Facts. The 16-bit blue channel is 74.8 at the default limits, which equals the expected value from the raw ramp, so the full 16-bit range is uploaded and scaled by Viv, not truncated to 8 bits. Halving the upper limit doubles the value and moving the lower limit to 20% gives (0.2933 - 0.2) / 0.8 \* 255 = 29.8. The other channels do not change.

Not done. The route in `src/viv/viv-route.ts` still draws RGB. Channel levels are read on the page by `source.getRaster`, one call per channel and tile, and not in the decode workers. Contrast change latency has not been timed. A slide with Z or T stacks in an order other than channel first is not read as channels.

## Follow-ups

- TODO VIEW-018 (multichannel fluorescence display) mounts the channel levels in the route, adds channel-aware regions to the decode workers and times a contrast change.
- [ADR 0111](../adr/0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md) records the source and level decisions.
