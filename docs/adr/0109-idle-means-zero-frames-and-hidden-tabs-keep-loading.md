# 0109. An idle viewer asks for no animation frames, and a hidden tab keeps loading without drawing on a timer

- Date: 2026-10-25
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: VIEW-032 (idle means zero work), VIEW-033 (hidden tab and background scheduling)

## Context

The Viv route let deck.gl's animation loop run at 60 Hz for as long as the tab was open. On CMU-1.svs, with the view loaded and nobody touching it, that was 605 to 607 animation frame callbacks and 90 to 194 ms of main-thread time in 10 s ([result](../results/2026-10-25-idle-and-hidden-tab.md)). The POC found the same and slept the loop by replacing a private method of luma.gl's `AnimationLoop` ([POC doc 24](../project/poc-reference.md)).

The POC also found that a hidden tab suspends `requestAnimationFrame` instead of throttling it ([POC doc 06](../project/poc-reference.md), notes 2, 3 and 5), so an engine that waits for a frame never moves again. Its fixes were a 500 ms watchdog beside each frame request, a loop generation counter that restarts a parked loop, and scheduling on a `MessageChannel` because hidden tabs clamp timers to 1 Hz.

Constraints in this repository:

- The engine owns one frame request at a time, and camera motion is time-based, so a motion can be advanced to any time.
- deck.gl 9.4.0 creates its `AnimationLoop` in the `Deck` constructor and asks for the first frame only after the device exists, which is asynchronous.
- luma.gl 9.4.2 lets an `AnimationLoop` take an `animationFrameProvider`, so the source of frames can be replaced through `setProps`.
- Golden images must stay identical.
- Playwright's headless Chrome cannot be made hidden. `bringToFront` on a second page, a minimized window through `Browser.setWindowBounds`, `Page.setWebLifecycleState` frozen and active, and launching without Playwright's three backgrounding flags all left `document.visibilityState` at `visible` with rAF running at 60 Hz. The protocol that Playwright ships has no visibility command.

## Options considered

For the deck.gl loop:

1. Replace `AnimationLoop._animationFrame` as the POC did. It works, but it depends on private names that can change in any luma.gl release.
2. Give the loop an `animationFrameProvider` that parks the loop's callback when nothing is left to do. It uses a prop that luma.gl declares, though it is marked experimental in 9.4. The loop's own cancel path already handles a parked request.
3. Stop and start the loop with `Deck.setProps({_animate})` or `animationLoop.stop()`. Stopping calls `onFinalize`, and a restart re-enters initialisation.

For a hidden tab:

1. Park everything until the tab is visible again. This is the least work, but the load stops at whatever stage it was in, and in a test with a 100 ms round trip a view hidden after the third tile read needed 1.09 to 1.11 s after the tab came back, against a budget of 1 s.
2. Keep drawing on a timer. Chrome clamps hidden timers to 1 Hz, so loading would advance one wave per second, and every frame draws a tab nobody sees.
3. Park the loop, and let each event that carries progress, such as a finished tile read, run one frame as a task on a `MessageChannel`. The load advances at the speed of the network and decoding, draws only when something changed, and stops by itself when the view is complete.

For measuring idle main-thread time:

1. Read `TaskDuration` from `Performance.getMetrics` and assert it is under 20 ms. In 12 idle windows of the two idle tests it was 5.0 to 30.6 ms with the sleep on, because Chrome runs a periodic PartitionAlloc memory reclaimer task in every renderer, once per 10 s window, and its cost follows the process heap. A blank page with a WebGL canvas measured 0.2 to 2.3 ms for the same task.
2. Trace the `toplevel` category for the window, sum the renderer main thread tasks, and report the tasks that come from Chrome's own source files (`partition_alloc_support.cc`, `memory_usage_monitor.cc`) apart from the rest. Assert on the rest.

## Decision

Deck loop: option 2. `createDeckSleep` in `src/viv/deck-sleep.ts` is the frame provider. After each frame it counts consecutive frames in which nothing was left to do (no redraw needed, the layer loaded, no tile read in flight, the decode pool idle). After 3 it keeps the loop's callback and requests nothing. It wakes on a camera or slide change, on every finished tile read, on a canvas resize in device pixels, on a device pixel ratio change, and as a last resort from `whenIdle` polling. A poll that finds the loop asleep with work left is counted as a rescue, and the tests assert the count is 0, so a missed wake cannot hide behind the poll.

Engine frames: the engine asks for a frame only while a camera motion runs or a change is waiting to be delivered, so it already idled. Its requests now go through `createGuardedFrames`, which adds the watchdog and the generation counter.

Hidden tab: option 3, and the rest of the POC's remedies, in four parts.

- The watchdog. While the tab is visible, each frame request also arms a 500 ms timer. Whichever fires first runs the callback and cancels the other, so no timer exists when nothing is pending. An engine given its own frame scheduler gets no watchdog unless it is given timers too, because that caller owns the timing.
- Hidden means tasks. A frame requested while the tab is hidden runs as a `MessageChannel` task, so camera subscribers hear of a change at once.
- Settle at once. When the tab hides, a running flight, eased zoom or coast jumps to its end (`controller.settle()` now also advances a coast to its computed end time), and a flight resolves `arrived`. Camera motion started while hidden does not animate at all, in the same way as with reduced motion.
- The generation counter. Every visibility change bumps a generation and re-arms every pending request, and a callback armed under an older generation is ignored, so a frame that a browser lost or a scheduler failed to cancel cannot run twice or block a new one.

`yieldToMain` uses `scheduler.yield` when it exists and a `MessageChannel` task otherwise, and `createTimeSlice` yields once a budget is spent. Nothing in the engine does long main-thread work today, so they are ready for the overlay and inference tasks and are used only by their own tests.

Idle measurement: option 2, with the raw `TaskDuration` reported next to it in the result file. The test also asserts zero frame requests, zero frame callbacks, zero timer callbacks, zero layouts and style recalculations and under 1 ms of script. The hidden tab cannot be produced in headless Chrome, so the test page installs a probe (`browser/page/frame-probe.ts`) that overrides `document.visibilityState`, dispatches `visibilitychange`, and withholds frames while hidden. In `hold` mode it releases them when the tab returns, as Chrome's main thread does. In `drop` mode it discards them, as a worker does. Timers requested while hidden wait at least 1 s from when the tab hid or the timer was set, and the probe re-arms them by their original due time when the tab returns, which matches how Chrome lifts throttling.

## Consequences

- The Viv route has an `isSettled()` query and a `sleep` object with `asleep()` and `stats()`. `sleepWhenIdle: false` restores the old always-running loop for measurement. `VivRouteOptions` and `ViewerEngineOptions` gain no other required fields. The engine takes an optional `scheduling` object with `visibility`, `timers`, `tasks` and `watchdogMs` for tests.
- The route no longer redraws synchronously from `changed()` while the tab is hidden. The frame that a wake runs does the drawing instead.
- A tab hidden before the first tile read has only throttled timers to start the load, because deck.gl's request scheduler issues tile requests from `setTimeout(0)`. It completed 609 to 738 ms after the tab returned. The test allows 2 s for this case and the 1 s budget for a view hidden once reads are flowing.
- A tile that fails counts as loaded in deck.gl 9.4 (`Tile2DHeader` sets `_isLoaded` before it reports the error), so one bad tile does not keep the loop awake.
- `animationFrameProvider` is experimental in luma.gl 9.4. A luma.gl update that renames it fails `installFrameProvider` at typecheck time, and the idle test fails if the loop stops sleeping. Keep luma.gl pinned to Viv's peers ([ADR 0098](0098-viv-and-deck-gl-versions.md)).
- Chrome's own reclaimer is not the viewer's cost. A budget of "under 20 ms of raw task time" cannot be promised for a page with a large heap, and the owner should say whether the attributed number is acceptable.
- The overlay layer system and any later frame user must call `route.sleep?.wake("change")` through `changed()` when they change what is drawn, or the loop stays asleep.
- Nothing was added to the backlog. VIEW-034 (GPU error handling) will need the same wake when a lost context is restored.
