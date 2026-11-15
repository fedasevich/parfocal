# Memory and leak suite

The nightly level 5 run that [ADR 0273](../adr/0273-test-pyramid-and-ownership.md) (test pyramid and ownership) and [ADR 0011](../adr/0011-hosted-ci-only.md) (hosted CI only) ask for. It runs on hosted Linux with SwiftShader, so it sees the JavaScript heap and live object counts but no GPU memory.

## What runs

The `memory` workflow runs every night at 02:23 UTC and on demand.

| Run | Where | Pass threshold |
| --- | --- | --- |
| 20 slide switches over a cycle with `CMU-1.svs` and `CMU-1.tiff` | `packages/viewer-engine/memory-nightly/leak.spec.ts` | one Deck per visit, heap within 10% of the post warm-up baseline, everything released on dispose |
| Long review session of 100 slide visits over the same cycle | same file | one Deck per visit, heap within 10% of baseline |
| 40 renderer route switches over `CMU-1.svs` | `browser/route-switch.spec.ts` with `ROUTE_SWITCHES=40` and `ROUTE_SWITCH_SLIDE=CMU-1.svs` | heap within 10% on each route, one canvas |
| 20 workspace round trips in the web app on the fake API | `apps/web/memory/workspace-switch.spec.ts` | report only, TODO |

The 10% budget is the one [ADR 0103](../adr/0103-memory-settings-and-test-baseline.md) (memory settings and test baseline) set after [the SwiftShader teardown result](../results/2026-10-23-memory-teardown-swiftshader.md) measured 3.9% to 4.0% over 20 switches of the small cycle.

## Reports

Every run writes a `*.trend.json` from `@parfocal/viewer-engine/heap-trend`, a pure module with unit tests in `test/memory/heap-trend.test.ts`. It holds the baseline, last and peak heap, growth after warm-up and a least squares slope in bytes per visit. `memory-nightly/summary.ts` prints them as a table in the job summary. The full sample files and heap snapshots at the end of warm-up and at the last visit are uploaded as the `memory-viewer` and `memory-web` artifacts for 14 days. Open a snapshot in Chrome DevTools, Memory tab, and compare the two to find what grew.

## Open thresholds

- TODO: a slope budget in bytes per visit for the slide switch and long session runs. Set it from the first nightly run of the `memory` workflow on main, with margin over the measured slope, and write the numbers in a result file.
- TODO: a growth budget for workspace round trips. Set it from the same first nightly run.
- TODO: a growth budget for renderer switches across all routes together. The per route budget already gates each route.
