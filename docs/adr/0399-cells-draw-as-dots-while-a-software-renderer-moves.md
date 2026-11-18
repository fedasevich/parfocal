# 0399. Cells draw as dots while a software renderer moves

- Date: 2026-11-18
- Status: Proposed
- Deciders: agent (VIEW-079)
- Backlog: VIEW-079

## Context

On CI's software renderer (SwiftShader) each pan frame of tumor_044 took about 400 ms, so the keyboard pan spec failed. The fake API now shows a result set's 900 cells on that slide, and the level of detail draws them as outlines because each cell is over 7 px on screen. Their casing and outline path layers hold 12,600 segments each, and with a 1 px scissor the frame still took about 280 ms, so the cost is vertex work and only fewer instances help. A hardware GPU draws the same frame in a few milliseconds. The [result file](../results/2026-11-18-software-renderer-pan-frames.md) has the numbers.

## Options considered

1. Draw cells that would be outlines as dots while the camera moves, only on a software renderer, and bring the outlines back 200 ms after the last move. The settled frame is unchanged, and hardware GPUs are untouched.
2. Drop only the casing while moving. It halves the vertex work, which still leaves frames near 200 ms.
3. Raise the 100 ms cap on how far one key pan frame may travel. The spec would pass while frames stay slow.
4. Switch cell outlines to a cheaper line layer everywhere. It changes the settled picture and the golden images.

## Decision

Option 1. The Viv route detects a software renderer the way the shader warmup already does, passes a moving flag to the overlay builder on every camera change, and the level of detail turns the outline tier into dots while that flag is set. The route reports itself unsettled until the outlines are back, so golden images and `whenIdle` still see the full detail. A pan frame of tumor_044 on SwiftShader went from about 420 ms to about 33 ms.

## Consequences

People on a machine without a GPU see cells as dots while they pan and outlines once they stop, which they already see when zoomed out. The deck.gl WebGPU route is unchanged, because it never runs on a software renderer.
