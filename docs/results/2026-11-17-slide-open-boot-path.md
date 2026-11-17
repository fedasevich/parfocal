# Result: tile access and the session check now start with the route instead of after the viewer code, and the slide's ranges run in five parallel rounds

- Date: 2026-11-17
- Backlog: TILES-011 (a slide opens in under 3 s from navigation)
- Kind: local Playwright runs of the built app on the fake API with a throttled network, and the engine's latency proxy test. No deployed "after"
- Commit: the TILES-011 branch, `perf(TILES-011): ...`
- Environment: the owner's Mac, Chrome through Playwright, `vite preview` of the e2e build

## Question

On v0.12.2 the owner opened test_065 from a fresh navigation: tile-access done at 3.87 s, levels.json at 4.09 s, the 10 original.tif ranges at 6.15 s. What does the app wait on before it asks for tile access, and do the ranges run in parallel?

## What the app waited on

`apps/web/e2e/slide-open-path.spec.ts` opens `/projects/p07/slides/a1/live` with Chrome's network emulation at 150 ms latency and 20 Mbit/s, and records every request's start and end from navigation. Before the change the order was:

1. The slide routes' loader awaited the viewer-engine chunk. TanStack Router renders nothing, the root included, until the loaders of the matched routes finish.
2. Only then did the root render, and `SessionLock` asked for `/api/me`. It shows the boot loader until `/api/me` settles.
3. Only then did the slide stage mount and ask for tile access.

So tile access waited for the viewer chunk, then `/api/me`, then a render.

## Change

- The slide routes' loader starts the viewer chunk without awaiting it and, on entering the route (not on a hover preload or a search change), asks for tile access. The stage takes that grant once if it is for the same slide and under 30 s old, and asks again if it failed, for example before the session is unlocked.
- `main.tsx` asks for `/api/me` as soon as the app starts on a signed-in path, instead of waiting for the first render.

## Numbers, three runs each, ms from navigation

| | viewer chunk done | `/api/me` start | tile-access start | levels.json start | stage ready |
|---|---|---|---|---|---|
| Before | 5,326, 5,260, 5,335 | 5,377, 5,406, 5,388 | 5,414, 5,446, 5,426 | 5,472, 5,504, 5,485 | 6,397, 6,410, 6,405 |
| After | 5,231, 5,345, 5,247 | 4,930, 4,910, 4,958 | 4,958, 4,935, 4,989 | 5,494, 5,483, 5,522 | 6,425, 6,410, 6,441 |

Tile access used to start 88, 186 and 91 ms after the viewer chunk arrived and now starts 273, 410 and 258 ms before it. `/api/me` moved the same way. The whole local open does not get shorter, and this harness cannot show that it would. The local preview serves about 270 JS files over HTTP/1.1, six at a time, so the boot to about 4.9 s is the harness. The fake API answers inside the page's service worker and took about 440 ms to answer tile access while the main thread was busy, so levels.json still starts at about 5.5 s. The deployed app serves over HTTP/2 and its tile-access takes 0.8 to 1.1 s, which now overlaps the viewer chunk and `/api/me` instead of following them. How much that saves deployed is not measured.

The same spec checks that a tab change in the URL sends no second tile-access request.

## Are the ranges parallel

`located-levels.test.ts` with `PARFOCAL_OPEN_WATERFALL=on` prints every request of a located open of an 11-directory BigTIFF behind the latency proxy at 100 ms:

| Round | Starts (ms) | Requests |
|---|---|---|
| levels.json | 0 | 1 |
| TIFF header | 107 | 1 |
| Directories | 214 to 216 | 11, all at once |
| A re-read of the last directory's first 432 bytes | 341 | 1 |
| Tile byte count arrays | 447 | 4, all at once |
| First tile | 566 | 1 |

So the reads run in parallel within each round, but after levels.json there are five rounds one after another. At the 400 ms a round takes deployed, five rounds come to about the 2 s the owner saw after levels.json. The deployed per-round time is inferred from the owner's numbers, not measured on its own. The header could come with levels.json, the re-read looks avoidable, and the byte counts could be asked for with the directories. That is follow-up engine work, TILES-012 (the slide's ranges arrive in two rounds after levels.json).

## Not covered

- The deployed boot. TODO after the next deploy: the owner's browser waterfall of test_065 from a fresh navigation.
- A Philips slide's ImageDescription. The synthetic BigTIFF has none, and test_065's large XML description may add a round of its own.
