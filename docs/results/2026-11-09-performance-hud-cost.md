# Result: the performance HUD costs 0.0032 ms per frame in Node, under the 0.5 ms budget

- Date: 2026-11-09
- Backlog: LAB-002
- Kind: benchmark
- Commit: the LAB-002 commit on its worktree branch
- Environment: Apple Mac shared with other agents, macOS, Node test runner, no browser
- Data: synthetic frame times of 16.7 ms, no slide, no PHI

## Question

Does the performance HUD's own per-frame work stay under 0.5 ms?

## Method

`apps/web/test/performance-hud.test.ts` runs 2,000 warm-up frames, then 20,000 frames of the HUD's real code. Every frame calls the frame meter record function, as the HUD does on each animation frame. Every 15th frame, which is the 250 ms refresh at 60 fps, it also builds the summary (mean, 95th percentile, fps) and the readout text. The total time divided by the frame count is the cost per frame, and the test fails above 0.5 ms. The command is `node --test test/performance-hud.test.ts` in `apps/web`.

## Results

| Run | Cost per frame |
| --- | --- |
| One run of 20,000 frames | 0.00322 ms |

## Interpretation

The measured work is the number crunching and text building. Writing the text into the page happens once per 250 ms and is not in this figure, nor is the browser's own layout cost for the small panel. The decode 95th percentile and resident tile reads in the live HUD are cheap property reads on the engine and are also not in this figure. A browser measurement of the whole panel remains open.
