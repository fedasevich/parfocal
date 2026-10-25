# Result: idle viewer frames and main-thread time, and a hidden tab mid-load

- Date: 2026-10-25
- Backlog: VIEW-032 (idle means zero work), VIEW-033 (hidden tab and background scheduling)
- Kind: baseline
- Commit: adc94fc with the VIEW-032 and VIEW-033 changes on top, not yet committed
- Environment: MacBook with Apple M4 (10 cores, 24 GB), macOS 15.8.1, Node 26.9.0, pnpm 12.9.1, Google Chrome 155.0.8059.86 driven headless by `@playwright/test` 1.64.0 with `channel: "chrome"` and the SwiftShader flags of `packages/golden-images/src/playwright.ts`. Viewport 1280 × 720 CSS pixels at a device pixel ratio of 1. Cross-origin isolated page. Slide and page served on localhost through `@parfocal/latency-proxy` at 0 ms RTT (idle tests) and 100 ms RTT (hidden tab tests), no bandwidth limit. geotiff 3.0.5, Viv 0.23.0, deck.gl 9.4.0, luma.gl 9.4.2
- Data: `CMU-1.svs` (Aperio, 46,000 × 32,914, `viewer` and `formats` fixture groups), six decode workers, 10x with the camera on the tissue centre (28,750, 10,700)

## Question

Does a loaded viewer that nobody touches ask for zero animation frames and use under 20 ms of main-thread time in 10 s (budget from the backlog, POC doc 24 reached 16 ms and 37 ms)? And when the tab is hidden in the middle of a load and shown again, is the view complete within 1 s of it returning?

## Method

All tests are in `packages/viewer-engine/browser/lifecycle.spec.ts` and run with `pnpm --filter @parfocal/viewer-engine test:browser`. The test page (`browser/page/lifecycle.html`) imports `browser/page/frame-probe.ts` first. The probe wraps `requestAnimationFrame`, `setTimeout` and `setInterval` and counts requests and executed callbacks.

Idle window. The test opens the slide, waits for `whenIdle()`, waits until the route reports that its deck loop is asleep, waits 2 s more so the last frame's compositor work is over, and then takes the counters, `Performance.getMetrics` (`TaskDuration`, `ScriptDuration`, `LayoutCount`, `RecalcStyleCount`) and starts a Chrome trace of the `toplevel` category. It sleeps 10 s in the test runner, so the page runs no `evaluate` in the window. Then it reads the same values and stops the trace. `browser/main-thread-trace.ts` sums the `ThreadControllerImpl::RunTask` events on `CrRendererMain`. Tasks whose source file is `base/allocator/partition_alloc_support.cc` or `third_party/blink/renderer/controller/memory_usage_monitor.cc` are Chrome's own periodic tasks and are summed apart as "Chrome internal". The rest is "page".

Three idle setups: after opening the slide, after a flight, five camera moves and a viewport resize, and as a control with `sleepWhenIdle: false`, which keeps deck.gl's loop running as it did before.

Hidden tab. Headless Chrome cannot be hidden (see ADR 0109), so the probe emulates it. `hide(mode)` makes `document.visibilityState` and `document.hidden` report hidden, dispatches `visibilitychange`, and withholds animation frames. In `hold` mode withheld frames run when the tab is shown again, as Chrome's main thread does. In `drop` mode they are discarded, as in a worker. Timers set or pending while hidden wait at least 1 s and are re-armed by their original due time when the tab returns. The test opens the slide through a 100 ms RTT proxy, waits for 3 finished tile reads, hides the tab for 1.5 s, shows it and polls `route.isSettled() && route.sleep.asleep()` every 10 ms. The poll does not wake the deck loop.

Also run: a flight running when the tab hides, a flight started while hidden, a visible tab whose animation frames are all dropped (`starve`), a tab hidden before the first tile read, and a dispose of a sleeping viewer followed by a count of live `Deck` objects through `Runtime.queryObjects`.

## Results

Idle windows of 10 s. Three runs of each setup, in run order. "rAF", "requests" and "timers" are the page's counters for the window. Layouts, style recalculations and script time were 0 in every sleeping run.

| Setup | rAF callbacks | rAF requests | Timer callbacks | `TaskDuration` (ms) | Trace total (ms) | Chrome internal (ms) | Page (ms) |
|---|---:|---:|---:|---|---|---|---|
| After open, sleep on | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 25.8, 29.3, 5.0 | 29.3, 31.9, 6.2 | 28.6, 30.8, 5.7 | 0.70, 1.08, 0.55 |
| After interaction, sleep on | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 10.1, 30.6, 13.7 | 11.1, 33.7, 14.9 | 10.8, 33.2, 14.5 | 0.28, 0.55, 0.41 |
| Sleep off (control) | 606, 605, 605 | 606, 605, 605 | 0, 0, 0 | 193.6, 139.3, 90.6 | 195.4, 139.1, 89.6 | 24.1, 7.6, 7.0 | 171.2, 131.5, 82.6 |

Script time with the sleep off was 89.8, 66.8 and 43.7 ms. Earlier runs of the two sleeping setups during development gave `TaskDuration` of 16.6, 9.2, 7.2 (after open) and 27.8, 16.3, 11.0 (after interaction), and page time of 0.30 to 1.12 ms.

The longest Chrome internal task in every sleeping window was a single `partition_alloc_support.cc` task (for example 17.2, 8.9, 29.8, 16.1 ms). A blank page with a WebGL canvas, measured with the same `TaskDuration` method in three 10 s windows, gave 1.76, 0.21 and 2.32 ms.

Sleep statistics of the sleeping runs: 2 or 3 sleeps, 26 to 57 frames over the whole test, 0 rescues in every run.

Hidden tab, three runs each, times from `show()` to complete:

| Case | Reads at hide | Reads before show | rAF callbacks while hidden | Complete after show (ms) |
|---|---:|---|---:|---|
| Hide after 3 reads, frames held | 3 | 23, 23, 23 | 0 | 114, 66, 128 |
| Hide after 3 reads, frames dropped | 3 | 20, 23, 23 | 0 | 136, 65, 111 |
| Hide before the first read, frames held | 0 | 13, 13, 13 | 0 | 738, 626, 609 |

The first design, which parked the deck loop for the whole time the tab was hidden, gave 1,089.8, 1,105.5 and 1,106.6 ms for the "3 reads, frames held" case, which missed the 1 s budget in 3 of 3 runs.

Visible tab with every animation frame dropped, after a camera move of 5,000 × 2,000 slide pixels: the view was complete after 2,050, 2,044 and 2,056 ms with 0 rAF callbacks, driven by the 500 ms watchdog. The camera subscribers were notified.

Flights: a flight running when the tab hid resolved `arrived` with the camera exactly on its target within 1 s of the hide (the poll interval was 20 ms). A flight started while hidden resolved `arrived` in under 250 ms with the camera on its target.

Disposing a sleeping viewer left 0 tab listeners and 0 live `Deck` objects after at most 5 garbage collections.

Other suites after the change: 454 unit tests passed, all 37 browser tests of the package passed (with 9 lifecycle tests), and the 16 golden image tests of `@parfocal/golden-images` passed with no golden file changed.

## Interpretation

Facts first. With the sleep on, the page ran no animation frame, timer, layout, style recalculation or script in 10 s, and the trace attributes 0.28 to 1.12 ms of the main thread to the page. The control shows the counter sees the loop when it runs: 605 to 606 callbacks and 83 to 171 ms of page time.

The raw `TaskDuration` of the sleeping runs was 5.0 to 30.6 ms, so it was over 20 ms in 4 of the 12 windows recorded. In every sleeping window the largest task came from Chrome's PartitionAlloc reclaimer, which Chrome runs once per 10 s. Assumption: its cost follows the size of the page's heap, because a blank page measured 0.2 to 2.3 ms. This was not tested by changing the heap. The test asserts on the page's share, so the 20 ms budget is checked against what the viewer controls.

A tab hidden once reads are flowing completes well inside the 1 s budget because each finished read runs one frame as a task, so the load advances while the tab is hidden. A tab hidden before the first read depends on deck.gl's request scheduler, which issues tile requests from `setTimeout(0)`. Timers are throttled in a hidden tab, and the emulated floor is 1 s. Assumption: real Chrome behaves the same, since its hidden-tab timer clamp is documented at 1 s, but the emulation was not compared with a real hidden tab.

The hidden tab itself is emulated. The real suspension of animation frames and the real timer throttling were not exercised.

## Follow-ups

- [ADR 0109](../adr/0109-idle-means-zero-frames-and-hidden-tabs-keep-loading.md) records the decisions.
- TODO: repeat the hidden tab case once in headed Chrome on the owner's Mac with a real second tab, to check the emulation.
- TODO: measure whether the Chrome internal task shrinks with a smaller heap, to explain the 5 to 30 ms range.
