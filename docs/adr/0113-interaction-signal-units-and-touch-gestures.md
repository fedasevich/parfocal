# 0113. A shared interaction signal, one units module and touch taps read by the gesture interpreter

- Date: 2026-10-26
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: VIEW-024 (coordinate systems and units), VIEW-035 (model inference pause during camera motion), VIEW-023 (touch navigation). Touches NAV-001 (magnification bar), NAV-002 (scale bar and readout) and the inference tasks that will run region passes in the browser.

## Context

[ADR 0104](0104-camera-controller-motion.md) keeps the camera controller free of DOM events, and [ADR 0107](0107-viewer-input-binding.md) puts input rules in a pure gesture interpreter. [ADR 0109](0109-idle-means-zero-frames-and-hidden-tabs-keep-loading.md) makes an idle engine hold no frame, task or timer. Three tasks add to this.

VIEW-035 needs one signal that background work respects: pause while the camera moves, resume 200 ms after rest. There is no inference engine in the browser yet, so the signal has to be framework-free and testable with a stand-in job. The POC's version is `poc/src/app/interaction.ts`.

VIEW-024 needs level-0 pixels as the canonical space with microns, screen coordinates, the scan objective and the "digital" label derived from the microns per pixel. Several slides have no microns per pixel, and the viewer must not invent an objective for them.

VIEW-023 needs touch gestures. Pinch and one-finger drag already ran through the interpreter, but nothing recognised taps. The POC has no tap or double-tap logic, so no tuned constants exist to reuse.

## Options considered

The interaction signal:

1. A boolean flag that the input binding sets on pointer down and clears on pointer up, plus a timeout. It misses eased zooms, flights and coasts, which keep moving after the finger lifts.
2. A signal whose `moving()` is derived from the clock, with a `pulse()` that every camera change calls and a `hold()` that a held gesture takes. The engine feeds it from `applyCamera`, so any motion counts, whatever started it. A timer runs only while something listens, so an idle engine keeps zero timers.
3. Poll the camera on every frame from the consumer. It wakes the frame loop that [ADR 0109](0109-idle-means-zero-frames-and-hidden-tabs-keep-loading.md) put to sleep.

The scan objective:

1. Always take the nearest objective preset to the native magnification. A slide at 1 micron per pixel would get a 10x label that the scanner never used.
2. Use a declared objective when the file has one. Otherwise take the nearest preset only when it lies within a factor of 1.25 of the native magnification, and give no objective beyond that.

Touch taps:

1. Rely on the browser's `dblclick` for touch. Chrome fires it for a one-finger double tap, but it carries no finger count, so a two-finger double tap cannot be told apart.
2. Recognise taps in the interpreter from pointer events with a timestamp. A tap is a press shorter than 300 ms that moved less than 10 px, a double tap is two taps within 350 ms and 40 px, and the finger count must match. The values sit in `touchTuning`, and the interpreter takes a replacement through a hook.

## Decision

Option 2 in each case.

| Concern | Rule |
|---|---|
| Signal | `createInteractionSignal` in `src/engine/interaction-signal.ts`. `moving()` is true while a hold is open or less than the rest time (200 ms) has passed since the last pulse. `whenRested(abort)` resolves at rest. The engine owns one by default and exposes it as `engine.interaction`. |
| Feeds | The engine pulses on every camera change. The input binding pulses on pan and zoom actions and holds the signal while a pointer gesture is active. |
| Units | `src/camera/units.ts`, built on `src/camera/magnification.ts`. Functions take the microns per pixel and return `null` when it is unknown. |
| Scan objective | Declared value, else the nearest preset within a factor of 1.25 of the native magnification at zoom 0, else `null`. |
| Digital label | True when the effective magnification is above the scan objective, and never when either is unknown. |
| Touch values | Tap slop 10 px, tap length 300 ms, double-tap window 350 ms, double-tap distance 40 px, target 40x, `dblclick` guard 500 ms. |
| Double tap | Zooms to 40x about the tap with `zoomToMagnification`, or by one octave when the slide has no microns per pixel. |
| Two-finger double tap | Flies to the tissue-aware whole-slide fit through `engine.flyToFit`, which uses the same `fitCamera` as the first fit ([ADR 0110](0110-native-jpeg-decode-and-tissue-fit.md)). |

The perf test in `browser/interaction.spec.ts` measures a stand-in busy job, not an inference engine. The numbers are in [the result file](../results/2026-10-26-interaction-pause.md).

## Consequences

- Any background job can wait on `engine.interaction` without knowing what moved the camera. The signal never requests a frame and arms a timer only while something listens.
- Chrome fires a `dblclick` after a touch double tap. The binding ignores a `dblclick` within 500 ms of a touch pointer, or the tap would zoom twice.
- The tap and double-tap values are choices, not measurements, and need a trial on real touch hardware. A double tap always goes to 40x, so a view already at 40x does not move.
- The 1.25 factor for the scan objective is a choice. A slide with a spacing outside it shows no objective and no digital label until the file declares one.
- `ViewerEngine` gains `interaction` and `flyToFit`. `InputTarget` gains optional `zoomToMagnification`, `flyToFit` and `fitToSlide`.
- `PointerInput` gains an optional `timeMs`. Input without it never produces a tap, so the existing replay traces behave as before.
