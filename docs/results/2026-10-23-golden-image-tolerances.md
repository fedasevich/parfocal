# Result: golden-image noise on SwiftShader and Metal

- Date: 2026-10-23
- Backlog: TEST-005 (golden-image rendering tests)
- Kind: baseline
- Commit: 84b603f plus the uncommitted TEST-005 changes in `packages/golden-images`
- Environment: Apple M4, macOS 15.8.1, Google Chrome 155.0.8059.85 headless through Playwright 1.64.0 with `channel: "chrome"`, Node 26.9.0. SwiftShader runs report `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)`. Metal runs report `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`. No network shaping. Other agents were running on the machine.
- Data: the synthetic 256 x 256 H&E-like tile from `syntheticHeTile()` (no PHI), drawn by the WebGL2 reference renderer in four scenes

## Question

How much do golden frames vary between runs on SwiftShader, how far is the hardware GPU from SwiftShader, and how far is a renderer with swapped R and B from the golden? The lossless tolerance must sit above the first and well below the last.

## Method

1. `GOLDEN_UPDATE=1 pnpm --filter @parfocal/golden-images exec playwright test` wrote the goldens on SwiftShader.
2. `GOLDEN_MEASURE=1 pnpm --filter @parfocal/golden-images exec playwright test render/measure.spec.ts` rendered each scene five times per variant, captured it with `readPixels` and compared it with its golden. Each row is the worst of the five runs by max channel delta.
3. The "default GPU" rows come from a second browser launched with `args: []`, which uses Metal on this Mac.
4. The "element screenshot agrees with readPixels" test compared both capture paths on every scene with an exact tolerance.

| Scene | Canvas | View |
|---|---|---|
| synthetic-1x-nearest | 256 x 256 | scale 1, nearest |
| synthetic-2x-nearest | 384 x 256 | scale 2, offset (-64, -32), nearest |
| synthetic-half-linear | 160 x 160 | scale 0.5, offset (16, 16), linear |
| synthetic-fractional-linear | 320 x 240 | scale 1.37, offset (-20.25, -10.5), linear |

## Results

| Scene | Variant | Max channel delta | Mean error R / G / B | Pixels over 2 levels | Lossless tolerance |
|---|---|---|---|---|---|
| synthetic-1x-nearest | SwiftShader | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass |
| synthetic-2x-nearest | SwiftShader | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass |
| synthetic-half-linear | SwiftShader | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass |
| synthetic-fractional-linear | SwiftShader | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass |
| synthetic-1x-nearest | SwiftShader, R and B swapped | 255 | 42.115 / 0.000 / 42.115 | 94.116% | fail |
| synthetic-2x-nearest | SwiftShader, R and B swapped | 223 | 41.748 / 0.000 / 41.748 | 93.518% | fail |
| synthetic-half-linear | SwiftShader, R and B swapped | 254 | 26.803 / 0.000 / 26.803 | 60.230% | fail |
| synthetic-fractional-linear | SwiftShader, R and B swapped | 247 | 41.504 / 0.000 / 41.504 | 93.534% | fail |
| synthetic-1x-nearest | Metal | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass |
| synthetic-2x-nearest | Metal | 0 | 0.000 / 0.000 / 0.000 | 0.000% | pass |
| synthetic-half-linear | Metal | 1 | 0.094 / 0.207 / 0.134 | 0.000% | pass |
| synthetic-fractional-linear | Metal | 1 | 0.009 / 0.021 / 0.016 | 0.000% | pass |

The element screenshot matched `readPixels` exactly on all four scenes. The 1:1 nearest scene matched the source tile exactly.

A deliberate regression was also tried: the shader was edited to always swap R and B, and the suite was run against the stored goldens. All four golden tests failed with "Mean R error ... exceeds 0.25" and "The frame matches the golden read in BGR order", and the edit was reverted.

## Interpretation

- SwiftShader is deterministic on this machine, so any nonzero delta in CI means the renderer or the browser changed.
- Metal and SwiftShader differ by at most 1 level and only where linear filtering interpolates, which is why goldens are always rendered on SwiftShader.
- The lossless tolerance of 2 levels and 0.25 mean error leaves room for a one-level backend difference and fails a swapped channel by a factor of more than 100 in mean error.
- Assumption: SwiftShader on the x86 CI runner behaves like SwiftShader on Apple silicon within 1 level. Not measured yet.

## Follow-ups

- [ADR 0101](../adr/0101-golden-image-comparison.md) records the method.
- TODO: confirm on the first `browser` CI run that the Mac-written goldens pass on hosted Linux, and record the result here.
- TODO: measure the JPEG and JPEG 2000 rows against real fixtures once the Viv route decodes them.
