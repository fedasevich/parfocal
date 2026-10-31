# 0107. Viewer input goes through a pure gesture interpreter, ends drags from the window and guesses the wheel device from its deltas

- Date: 2026-10-23
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-021 (wheel, trackpad and pinch handling), VIEW-043 (drags that always end). Touches VIEW-022 (keyboard navigation), VIEW-023 (touch navigation), VIEW-045 (camera feel profiles), CMD-001 (key registry), SET-006 (navigation and devices section) and the annotation tools.

## Context

[ADR 0104](0104-camera-controller-motion.md) left DOM input to VIEW-021: the camera controller binds no events, because which drag pans depends on the tool. VIEW-021 asks for wheel zoom by default, pinch told apart from Ctrl+wheel by delta shape, a cap of half an octave per event, middle-drag and Space+drag in any tool, a wheel mode setting whose default `auto` tells a trackpad from a mouse wheel, Shift+wheel in pan mode, and double-click zoom unless the click lands on a shape the tool edits. Its "Done when" line asks for unit tests that replay event traces from a mouse, a Mac trackpad and a Windows precision touchpad. VIEW-043 asks that a drag end on `pointerup`, `pointercancel`, `lostpointercapture` and window `blur` without relying on pointer capture (POC doc 06 §15).

The POC put all of this in one class that listened to the DOM and moved the camera (`poc/src/camera/camera-controller.ts`). Its device guess (`wheelIntent`) calls a stream a trackpad on a fractional delta or any horizontal delta, and a mouse after two whole single-axis deltas of 100 or more. Its per-event cap was 0.45 in natural log units, which is 0.65 octaves.

No keyboard registry (CMD-001) and no annotation tools exist yet, so Space and the "click lands on a shape" rule need hooks.

## Options considered

Where the logic lives:

1. One class that listens to the DOM and drives the camera, as in the POC. Little code, but every test needs a DOM, and replaying a recorded trace needs a browser.
2. A pure interpreter that turns a plain input record into a list of actions (start, move or end a drag, pan, zoom, capture, cursor, prevent default), with a thin DOM adapter that reads events and applies the actions to the engine. Traces replay in Node against the real camera controller, and the adapter is small enough to cover with browser tests.

Where drags end:

1. Listen for `pointerup` and `pointercancel` on the viewer only and rely on capture. This is the POC bug: a refused capture or a release over another element strands the drag.
2. Listen for `pointermove`, `pointerup` and `pointercancel` on the window, `lostpointercapture` on the viewer and `blur` on the window, keep pointers in one map that any of them clears, and also end a mouse drag on a move whose `buttons` is 0, which catches a release the page never saw.

How `auto` guesses the device:

1. The POC rule alone. It reads a Chrome-on-macOS mouse, whose deltas are multiples of 4.000244140625 according to the wheel handler of mapbox-gl-js, as a trackpad.
2. The POC rule with two additions from mapbox-gl-js's `scroll_zoom.ts`: a multiple of 4.000244140625 is a mouse at once and a delta under 4 is a trackpad at once. Line and page mode are a mouse at once. Two-axis or fractional deltas are a trackpad. A whole single-axis delta of 50 or more counts as mouse evidence, and two in a row switch back to the mouse. Everything else leaves the guess alone.
3. Mapbox's timing rule, which waits 40 ms on the first event of a stream. It delays the first notch, which reads as lag.

## Decision

Option 2 in each case.

| Concern | Rule |
|---|---|
| Where | `src/input/wheel.ts` (pure wheel maths), `src/input/gestures.ts` (`createGestureInterpreter`), `src/input/dom-input.ts` (`bindViewerInput(element, engine, options)`) in `packages/viewer-engine` |
| Hooks | `primaryDragPans(input)` says whether a left drag or one finger pans in the active tool (default yes, the hand tool). `panModifierHeld()` is the Space hook until CMD-001 exists. `hitsEditableShape(at)` lets the tool keep a double-click (default never) |
| Pan | Left drag when the tool pans, middle drag in any tool, left drag while the pan modifier is held. The right button never pans |
| Drag end | `pointerup` ends with the controller's throw. `pointercancel`, `lostpointercapture`, window `blur`, a hidden page and a mouse move with no button held clear every pointer and stop without a throw. Capture is tried inside `try` |
| Coalesced samples | Each `getCoalescedEvents()` sample reaches `dragTo` with its age, so the controller times it correctly. `dragTo` in the controller takes an optional sample time and the engine's `dragTo` an optional age in ms |
| Wheel zoom | 0.0022 per CSS pixel and 0.0075 per pinch unit in natural log units (the POC's rates), line mode as 16 px and page mode as 400 px, capped at 0.5 octaves per event as the backlog says. A notch is eased, a pinch is not. A zoom during a drag is not eased and the drag carries on |
| Pinch | A Ctrl wheel event in pixel mode with a fractional delta or one under 40 that is not a Mac mouse step. Two touch pointers pan by their midpoint and zoom by the ratio of their spread, and lifting one hands back to a drag |
| Wheel modes | `auto` (default), `zoom` and `pan`. Ctrl or Cmd always zooms. Shift+wheel with no horizontal delta pans sideways |
| Double-click | One octave in about the cursor, Alt for one out, eased |
| Page | The viewer gets `touch-action: none`, `user-select: none` and the grab cursor (grabbing while dragging). The document gets `overscroll-behavior: none`. Dispose restores all of them |

The interpreter cannot rely on its first guess, because a fresh stream from a Mac trackpad may start with a whole delta. The trace tests therefore ask that 80% of a trackpad scroll pans, not all of it.

## Consequences

- The VIEW-021 traces in `packages/viewer-engine/test/input/traces` are synthetic, modelled on documented behaviour, and say so in their file names and a `todo` field. TODO: record a mouse, a Mac trackpad and a Windows precision touchpad with `pnpm --filter @parfocal/viewer-engine traces:record` and commit the files. The replay tests run on every file in the folder.
- TODO: a Chrome-on-macOS mouse notch of 4.000244140625 zooms only 0.013 octaves at the POC's rate. If a recorded trace confirms that delta for one notch, the mouse rate or the step size needs a fix.
- The wheel and pinch rates and the per-event cap live in the camera profile of VIEW-045 (camera feel profiles, [ADR 0106](0106-camera-bounds-and-feel-profiles.md)), and `bindViewerInput` reads them live from the engine. The double-click step is still a constant in `src/input/gestures.ts`.
- VIEW-022 (keyboard navigation) and CMD-001 (key registry) replace the Space hook's source, not the hook. The annotation tools fill `primaryDragPans` and `hitsEditableShape`.
- VIEW-023 (touch navigation) builds double tap and its own Playwright touch tests on the same interpreter.
- Read-only overlays such as the readout must keep `pointer-events: none`. The browser test shows a drag still ends over an overlay that takes pointer events, because the release reaches the window.
