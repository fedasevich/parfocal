# Pan frames on a software renderer with many cell outlines

- Date: 2026-11-18
- Task: VIEW-079
- Machine: the Mac, Chrome headless with `--use-angle=swiftshader --enable-unsafe-swiftshader --disable-gpu`, one Playwright worker, the dev server with the fake API
- Slide: tumor_044 in the fixture project, 888 by 676 canvas, device pixel ratio 1, ArrowRight held for 1.5 s

## Before

The gap between animation frames during the pan was 333 to 450 ms, with one long task of the same length per frame. A Chrome trace put the time in `GLES2::ReadPixels` on the renderer main thread waiting for `WebGL CommandBuffer::Flush` on the GPU thread.

Each frame drew 23 tile quads, two path layers of 12,600 instances (the casing and outline of the result set's 900 cells) and two of 11 instances (its two regions).

| Change to the frame | Frame gap |
| --- | --- |
| None | 333 to 450 ms |
| Skip every bitmap tile draw | 333 to 450 ms |
| Skip the two 12,600 instance path draws | 17 to 33 ms |
| Draw them inside a 1 by 1 px scissor | about 283 ms |

## After

With cells drawn as dots while moving, the pan frame gap was 17 to 33 ms (camera updates 25 to 38 ms apart). One frame of about 170 ms follows 200 ms after the last move, when the outlines come back.
