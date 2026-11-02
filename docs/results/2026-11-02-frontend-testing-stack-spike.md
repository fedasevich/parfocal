# Frontend testing stack spike: Viv and WebGPU frames on SwiftShader

- Date: 2026-11-02
- Task: STACK-012 (frontend testing stack)
- Decision: [ADR 0146](../adr/0146-frontend-testing-stack.md) (frontend testing stack)

## Question

Can hosted GitHub runners render one Viv tile and one WebGPU frame with software rendering and compare them to golden images written on the owner's Mac, as [ADR 0011](../adr/0011-hosted-ci-only.md) (hosted CI runners only) requires?

## Setup

- Local: Apple M4, macOS 15.8.1, Google Chrome 156.0.8078.74, headless, launched by Playwright 1.64.0.
- CI: `ubuntu-latest` x86 runner, Google Chrome 156.0.8078.47 as installed on the runner, the `browser` job of the `ci` workflow.
- WebGL flags: `--use-angle=swiftshader --enable-unsafe-swiftshader` ([ADR 0101](../adr/0101-golden-image-comparison.md), golden images compared per channel on SwiftShader frames).
- WebGPU flags: the WebGL flags plus `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`, on a secure origin served by `page.route`.
- The WebGPU spec is `packages/golden-images/render/webgpu-swiftshader.spec.ts`. It uploads the 256 by 256 synthetic H&E tile to an `rgba8unorm` texture, draws it at 1:1 with `textureLoad` into an opaque canvas, captures an element screenshot and compares it with the existing WebGL golden `synthetic-1x-nearest.png`.

## Results

| Check | Where | Outcome |
|---|---|---|
| `navigator.gpu` on `about:blank` | M4 | absent, WebGPU needs a secure origin |
| WebGPU adapter with WebGL flags only | M4 | `requestAdapter()` returns null |
| WebGPU adapter with the WebGPU flags | M4 | vendor `google`, architecture `swiftshader`, fallback adapter |
| WebGPU tile against the WebGL golden, exact tolerance | M4 | max delta 0, 0, 0, differing fraction 0 |
| WebGPU tile with red and blue swapped | M4 | fails the exact comparison, report names BGR order |
| WebGPU spec, 3 tests | M4 | 3 passed in 3.9 s |
| WebGL renderer string | CI run 41485331959 | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` |
| Viv CMU-1.svs goldens at fit, 10x and 40x, written on the M4 | CI run 41485331959 | passed under the JPEG row |
| Synthetic WebGL goldens and the 1:1 exact tile check, written on the M4 | CI run 41485331959 | passed |
| Golden-images suite in total | CI run 41485331959 | 61 passed, 8 skipped in 2.6 min |
| WebGPU adapter and WebGPU tile on hosted Linux | CI | TODO: first completed `browser` run after commit dd81b8c |

The CI evidence is job 125414049630 of run 41485331959 on commit e08504d, which finished green on 2026-11-02. The Viv specs print pass or fail, not the measured delta, so the exact M4 to x86 difference on Viv frames is not known. It is inside the JPEG row (4 levels, 0.5% of pixels, mean 1.0).

## Interpretation

- The Viv tile spike the backlog asks for already runs in CI on every push, through the harness of ADR 0101. Goldens written on the M4 pass on hosted x86 SwiftShader, which closes the open assumption in [the tolerance result](2026-10-23-golden-image-tolerances.md) and [the Viv route result](2026-10-23-viv-route-goldens.md) for every scene that passed.
- WebGPU on SwiftShader draws the same bytes as WebGL on SwiftShader for an unfiltered 1:1 draw on the M4, so a WebGPU renderer can share the WebGL goldens and the element screenshot path.
- WebGPU in headless Chrome needs two extra flags and a secure origin. Without them a WebGPU test silently has no adapter.

## Follow-ups

- TODO: record the hosted Linux numbers of the WebGPU spec here from the first completed `browser` run that includes it.
- TEST-008 (visual regression for UI) decides Playwright `toHaveScreenshot` for UI chrome, as ADR 0146 proposes.
