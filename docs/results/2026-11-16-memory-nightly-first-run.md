# Result: the first memory workflow run on a hosted runner keeps the slide switch heap within 2.5% and sets three budgets

- Date: 2026-11-16
- Backlog: TEST-007 (memory and leak suite)
- Kind: baseline
- Commit: the `memory` workflow run 43862806584, started by hand on the branch `claude/bold-lamarr-e13a40`, which held the train of 2026-11-15 and the workflow fix of this change. The same workflow on `main` (run 43861316343) passed too but lost the slide switch reports, see Interpretation
- Environment: GitHub hosted `ubuntu-24.04`, Google Chrome 157.0.8103.78 driven by `@playwright/test`, WebGL2 reported as `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`, so software rendering. No network shaping
- Data: the `small` and `viewer` fixture groups (`CMU-1.svs`, `CMU-1-Small-Region.svs`, `CMU-1.tiff` and two synthetic TIFFs). No PHI

## Question

Do the 20 slide switches, the 100 visit review session, the 40 renderer switches and the 20 workspace round trips of `.github/workflows/memory.yml` pass on a hosted runner with software rendering, and what heap numbers should their open budgets use ([memory suite](../knowledge/memory-suite.md))?

## Method

`gh workflow run memory --ref claude/bold-lamarr-e13a40` with the default 100 long session visits. Each run writes a `*.trend.json` from the heap trend module. The numbers below are those files from the `memory-viewer` and `memory-web` artifacts.

## Results

| Run | Samples | Baseline | Last | Peak | Growth after warm-up | Slope a visit | Budget before |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 20 slide switches with CMU-1.svs | 26 | 11.9 MB | 12.1 MB | 12.2 MB | 2.5% | -9.0 KB | 10% growth |
| Long review session of 100 visits | 106 | 11.8 MB | 12.1 MB | 12.2 MB | 2.5% | -0.6 KB | 10% growth |
| 40 renderer switches, all routes | 45 | 7.0 MB | 8.9 MB | 9.5 MB | 26.8% | 17.6 KB | report only |
| 20 workspace round trips | 23 | 15.8 MB | 19.8 MB | 19.8 MB | 25.4% | 197.0 KB | report only |

All four runs passed. Every slide visit had one Deck, no load timeout and nothing alive after dispose. The first run of the same workflow on `main` showed 2.6% and 2.6% for the two slide runs and 26.8% and 25.4% for the other two, so the numbers repeat.

## Interpretation

The two slide runs have no climb, so a slope budget of 10 KB a visit leaves room for noise and still fails a leak of about 1 MB over a 100 visit session, which is where the 10% growth budget would trip anyway. The 26.8% of the renderer switches mixes three routes with different heap floors, and the per route gate of 10% still applies to each. The workspace round trips climb 197 KB a visit and level off at the end, which looks like a query cache filling rather than a leak, but one run cannot tell. These are single run budgets with a margin of about one and a half times, so they are starting values.

The `memory` workflow ran the route switch with a second `playwright test` command, and Playwright empties `test-results` at the start of each command. The first run on `main` therefore lost the slide switch reports and heap snapshots, and only the route switch files reached the artifact. The route switch step now writes its test output to `test-results/route-switch`.

## Follow-ups

- Budgets set: slope 10 KB a visit for both slide runs, growth 40% for the workspace round trips and for all routes together.
- TODO: find out from the two heap snapshots of the `memory-web` artifact whether the workspace round trips keep growing beyond 20 rounds.
