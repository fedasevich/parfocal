# 0101. Golden images compared per channel on SwiftShader frames

- Date: 2026-10-23
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: TEST-005 (golden-image rendering tests). Touches STACK-012 (frontend testing stack), TEST-008 (visual regression for UI) and every VIEW task whose "Done when" names a golden image.

## Context

TEST-005 needs rendered slide views compared against stored images, with per-format tolerances, in headless Chromium with SwiftShader on hosted runners ([ADR 0011](0011-hosted-ci-only.md)). It must catch a swapped colour channel and must reject empty frames, because POC doc 23 found an empty frame that benchmarked faster than a correct one. The Viv renderer does not exist yet, so the harness has to accept any renderer route later. Three choices had to be made: how to capture a frame, how to compare it and where the goldens come from.

## Options considered

Capture:

1. `readPixels` on the WebGL drawing buffer. Exact bytes before compositing, but the renderer must keep `preserveDrawingBuffer: true` and it does not work for WebGPU.
2. An element screenshot. Works for any canvas, WebGL or WebGPU, but passes through the compositor, which could scale, colour-manage or blend.

Comparison:

1. Playwright's `toHaveScreenshot`. Built in, with an update flag and diff images. It uses pixelmatch's YIQ distance with one threshold, names snapshots per platform (`-darwin`, `-linux`) and only captures screenshots.
2. A perceptual metric such as SSIM on luma. Tolerant of small shifts, but a luma-only score barely moves when R and B swap, which is the defect the task names, and it hides colour errors a pathologist sees.
3. CIEDE2000 colour difference per pixel. Perceptual and colour-aware, but the tolerance is in units few people can read, it costs a colour-space conversion per pixel, and it says nothing about which channel is wrong.
4. Per-channel absolute difference with three limits: the largest allowed delta in any of R, G or B, the fraction of pixels allowed past it and the mean error per channel. Plain, cheap and strict on colour, and it reports which channels moved. It is not perceptual, so a one-pixel shift in a sharp edge counts fully.

Where goldens come from:

1. Whatever GPU the developer has, with a looser tolerance. Goldens written on a Mac with Metal would then be compared against SwiftShader in CI.
2. SwiftShader everywhere. Chrome on macOS also ships SwiftShader, so `--use-angle=swiftshader --enable-unsafe-swiftshader` gives the same backend locally and in CI.

## Decision

Per-channel absolute difference (comparison option 4) on frames rendered by SwiftShader everywhere (goldens option 2), captured with `readPixels` when the renderer allows it and with an element screenshot otherwise. The code is `packages/golden-images`.

- Per-channel wins because the defects that matter for pathology are colour defects. A swapped channel gives a mean R and B error of 26.8 to 42.1 levels on the synthetic scenes, far past every tolerance, while G stays at 0, and the report says the frame matches the golden in BGR order. SSIM on luma would need a tuned threshold to see that, and CIEDE2000 would see it without saying why.
- Tolerances are per codec, and each slide format maps to one: lossless (2 levels, 0.1% of pixels, mean 0.25), JPEG (4, 0.5%, 1.0) and JPEG 2000 (6, 1%, 1.5). The lossless row was checked against measurements. The JPEG rows are starting values until the Viv route decodes real fixtures.
- SwiftShader everywhere wins because it made every scene byte-identical across five runs, while Metal differed from it by up to 1 level on the linear-filtered scenes ([result](../results/2026-10-23-golden-image-tolerances.md)). The suite asserts the WebGL renderer string contains "SwiftShader" and fails otherwise.
- Every frame passes an empty-frame check before it is compared or written: at least 16 colours, no colour on more than 98% of the pixels, luma standard deviation of at least 2 and not fully transparent. A cleared canvas fails this, and `golden:update` refuses to store it.
- Both capture paths were measured equal on every scene (exact match), so a WebGPU renderer can use screenshots without a looser tolerance.

## Consequences

- `pnpm golden:update` rewrites the goldens and the [package README](../../packages/golden-images/README.md) says how to review them. A mismatch writes `actual` and `diff` PNGs into `test-results/`.
- A new `browser` CI job runs `pnpm test:browser` under `ci-ok`. It uses the runner's installed Chrome, as the `e2e` job does.
- Renderers in golden mode must create their WebGL context with `preserveDrawingBuffer: true`, or the spec must use the screenshot path.
- Goldens written on an Apple M4 have not yet been compared with SwiftShader on the x86 CI runner. TODO: check the first CI run. If SwiftShader on x86 differs by 1 level on linear scenes, the lossless row already absorbs it.
- STACK-012's spike can reuse this harness for its Viv tile instead of building a second one, and TEST-008 can choose Playwright's screenshot assertions for UI chrome, where perceptual tolerance fits better than per-channel rules.
