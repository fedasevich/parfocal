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

## In CI

Measured with temporary diagnostics on draft PR 25 (CI frame diagnostics, runs 44235331062, 44239888023 and 44242772365), GitHub's `ubuntu-24.04` runner, Chrome headless, three web shards.

The WebGL renderer was `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` and luma.gl reported `gpuType: "cpu"`, so the software check fired and cells drew as dots while moving.

| Spec | What the frames showed |
| --- | --- |
| Polygon keyboard pan on tumor_044 | One long task of 622 ms on the first move (the dot layer is built for the first time), then frame gaps of 117 to 150 ms with deck's draw call under 5 ms. A 250 ms key hold therefore got one or two frames, 6 to 10 px. |
| Follow view, leader in front | Frame gaps of 67 to 167 ms, a long task of 50 to 160 ms each frame. |
| Follow view, follower in the background | No animation frame for 1017 ms with no long task on its main thread, so the engine's frames came from the 500 ms watchdog, and slow follow steps reached 405 and 501 ms. |
| Follow view, follower in front | Frame gaps mostly 17 ms, none from the watchdog, longest 133 ms. |

The specs now hold ArrowRight until the vertex has moved 20 px, and bring the follower page to the front while it is timed. Both passed in run 44242827311 on draft PR 26 with the diagnostics removed.
