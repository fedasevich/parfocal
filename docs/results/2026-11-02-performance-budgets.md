# Result: baselines of the performance budget suite

- Date: 2026-11-02
- Backlog: TEST-006 (performance budget suite)
- Kind: baseline
- Commit: 15d99c3 with the TEST-006 changes on top, not yet committed
- Environment: Apple M4, macOS 15 (Darwin 24.6.0), Node 26.13.0, pnpm 12.9.1, Google Chrome headless through Playwright 1.64.0 with the SwiftShader flags of `packages/golden-images/src/playwright.ts`, viewport 1280 × 720 at a device pixel ratio of 1. Another agent was working on the machine.
- Data: `CMU-1.svs` (Aperio, `viewer` fixture group), a generated 11-level spread BigTIFF, the production build of `apps/web`

## Question

What are the baselines for the CI budgets in `perf-budgets.json`, and how much of each time is network and how much CPU?

## Method

1. `node --test test/route-chunks.test.ts` in `apps/web` builds the app for production and gzips every JavaScript and CSS asset with `node:zlib` at its default level.
2. `pnpm exec playwright test browser/budgets.spec.ts` in `packages/viewer-engine` serves the harness page and the slide through the latency proxy at each RTT of the matrix. Each of three runs creates the engine with six decode workers, opens `CMU-1.svs` at the fitted view and waits for `whenIdle`, then sets the camera to 10x at the tissue centre (28,750, 10,700) and waits again. Times are the fastest of three runs. Requests and bytes are the slide server's log, the most of three runs.
3. `node --test test/pixel-source/tile-index.test.ts` in `packages/viewer-engine` opens the spread BigTIFF with its sidecar at 100 ms RTT, three times per run, and reads the coarsest tile. Three runs.

## Results

Bundle, gzip bytes:

| Bundle | Bytes |
|---|---|
| First page | 320,920 |
| Viewer engine chunk | 358,042 |
| All JavaScript and CSS | 2,461,599 |

SHELL-001 measured the first page at 319,638 bytes earlier the same day.

`CMU-1.svs`, one run of the spec:

| RTT (ms) | Fitted (ms) | Fitted requests | Fitted bytes | Sharp after jump (ms) | Jump requests | Jump bytes |
|---|---|---|---|---|---|---|
| 0 | 859 | 8 | 7,683,267 | 283 | 13 | 13,631,488 |
| 50 | 1,390 | 8 | 7,683,267 | 732 | 13 | 13,631,488 |
| 100 | 1,871 | 8 | 7,683,267 | 1,382 | 13 | 13,631,488 |
| 200 | 3,174 | 8 | 7,683,267 | 2,698 | 13 | 13,631,488 |

A second run of the spec gave the same requests and bytes at every RTT, and fitted and jump times of 750 and 250 ms at 0 ms RTT and 3,193 and 2,699 ms at 200 ms RTT.

Sidecar open at 100 ms RTT, fastest of three per run: 346, 369 and 375 ms. The IFD walk took 1,368, 1,386 and 1,384 ms.

## Interpretation

- Requests and bytes did not change with RTT, so they are deterministic enough to hold a 20 percent limit on any runner.
- Between 0 and 200 ms RTT the fitted time grows by 2,315 ms and the jump time by 2,415 ms, about 12 round trips each. The CPU part at 0 ms RTT is 859 and 283 ms. The time limits at 200 ms RTT are twice the baseline, which covers a runner three times slower on the CPU part.
- The jump downloads 13 requests of exactly 1 MiB, the range cache's block size.
- Assumption: hosted runners are at most three times slower on the CPU part. TODO: record the numbers from the first browser CI run and tighten the time limits.

## Follow-ups

- TODO: frame p95 while panning and overlay GPU time at 81,000 and 1,600,000 nuclei, by hand on the owner's Mac.
- TODO: hover preview latency once AISEG-006 (hover preview) is built.
