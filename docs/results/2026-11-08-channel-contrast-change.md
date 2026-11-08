# Result: A channel contrast change redraws without re-reading tiles

- Date: 2026-11-08
- Backlog: VIEW-018 (multichannel fluorescence display)
- Kind: baseline
- Commit: b5e06a98
- Environment: Apple M4 Mac shared with other agents, Chrome headless with SwiftShader through Playwright with one worker, loopback server
- Data: the 16-bit synthetic multichannel fixture, no slide data

## Question

Does a contrast change on a 16-bit channel show within one frame, as the POC did in 16 ms?

## Method

The viewer-engine `channels` browser spec opens the 16-bit fixture on the Viv route, changes the contrast limits of one channel four times, counts the frames until the view settles and counts decode-worker reads during each change.

## Results

| Change | Time to settle | Frames | Worker reads |
|---|---|---|---|
| 1 | 2.6 ms | at most 2 | 0 |
| 2 | 6.6 ms | at most 2 | 0 |
| 3 | 12.2 ms | at most 2 | 0 |
| 4 | 16.0 ms | at most 2 | 0 |

## Interpretation

Every change stayed within the POC's 16 ms and read no tiles, on software rendering. The spec asserts at most 2 frames and no worker reads, not the 16 ms itself, so a slower machine does not fail it.

## Follow-ups

TODO: measure on a real GPU and decide whether to assert one frame.
