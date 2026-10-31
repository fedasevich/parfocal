# 0104. The camera controller runs inside the engine's frame and flies a smooth zoom and pan path

- Date: 2026-10-23
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-020. Touches VIEW-021, VIEW-035, NAV-001, DS-016 and every task that flies to an object, such as G and a number to fly to an area.

## Context

VIEW-020 (camera controller) asks for pan, zoom to the cursor, inertia, zoom limits defined in one place, objective-based zoom presets, a fly-to that takes 400 to 700 ms by distance and cancellation by any new input. [ADR 0100](0100-viewer-hot-path-state-outside-react.md) keeps the camera in the framework-free engine, which notifies subscribers at most once per animation frame.

The kit's motion spec says what a flight to an area looks like ("The camera flies: zoom out a little, pan, zoom in to the area", 400 to 700 ms by distance), that nothing blocks input and a new key cancels the current transition, and that reduced motion turns every transition into a cut. It names no easing curve for the flight and no way to turn distance into a duration.

The POC's controller (`poc/src/camera/camera-controller.ts`) had no real fly-to. Its animated `setCamera` jumped the centre and eased only the scale. It ran its own `requestAnimationFrame` loop beside the app's. Its zoom limits were computed in two places, and a comment in `viewport.ts` records the bug that caused: an animation toward a scale the clamp rejected kept deriving a centre for that scale, and the view slid sideways on every frame.

## Options considered

The flight path:

1. Interpolate the centre linearly and the zoom linearly in log space. Simple, but a long flight at high power crosses screens of tissue too fast to follow, and it never zooms out, which the kit asks for.
2. A scripted three-phase flight: zoom out, pan, zoom in, each with its own share of the time. It matches the kit's words, but the share of each phase and the depth of the zoom-out need tuning per distance, and the joints between phases show as changes of speed.
3. The smooth zoom and pan path of van Wijk and Nuij (2003), the one `d3.interpolateZoom` and deck.gl's `FlyToInterpolator` use. It zooms out by as much as the distance needs, moves at constant perceived speed and has one parameter, the curvature, set to √2 as d3 does by default. It also gives a path length that measures how far a flight really is, counting the change of zoom as well as the pan.

The animation clock:

1. The controller owns a `requestAnimationFrame` loop, as in the POC. A camera change made inside that loop then reaches subscribers through the engine's own frame, one frame late, and there are two loops to keep in step and to stop on unmount.
2. The engine's frame calls the controller's `step()` first and then notifies subscribers. One loop, subscribers hear the frame they are drawn in, and the clock and the frame scheduler are injected, so the physics runs deterministically in unit tests.

## Decision

Option 3 for the path and option 2 for the clock.

| Concern | Rule |
|---|---|
| Where | `createCameraController` in `packages/viewer-engine/src/camera/controller.ts`, owned by `createViewerEngine`. Pure physics in `src/camera/physics.ts` and the flight in `src/camera/flight.ts` |
| Zoom limits | One set of bounds per engine, applied only by `clampZoom` and `clampCamera` in `src/camera/camera.ts`. Every target is clamped before an anchor or a path is derived from it, so a motion never chases a zoom it cannot reach. Since VIEW-042 (camera bounds at the slide edges) the bounds follow the slide and the centre stays on it ([ADR 0106](0106-camera-bounds-and-feel-profiles.md)) |
| Pan | `panBy` moves the content by screen pixels at the current zoom |
| Zoom to cursor | `zoomTo` and `zoomBy` keep the slide point under the anchor fixed on every frame. Steps add to the target of an eased zoom still running. The ease is exponential with a 55 ms time constant, the POC's value |
| Inertia | A drag records samples from the last 70 ms. A release within 60 ms of the last move at 0.04 px/ms or more coasts with a 130 ms exponential decay until 0.01 px/ms. These are the POC's values. Steps are integrated exactly, so the coast covers the same ground at any frame rate. Since VIEW-042 (camera bounds at the slide edges) and VIEW-045 (camera feel profiles) the coast ends at the computed time its speed reaches 0.01 px/ms rather than on the first frame after, stops per axis at the slide edges, and takes its values from the camera profile ([ADR 0106](0106-camera-bounds-and-feel-profiles.md)) |
| Fly-to | `flyTo` and `flyToArea` follow the van Wijk and Nuij path with curvature √2. The duration is 400 ms plus 300 ms times the path length over 4, capped at 700 ms. Time is eased with a cubic ease in and out. The last frame lands exactly on the target and the promise resolves `"arrived"` |
| Presets | `objectivePresets` (1.25, 2.5, 5, 10, 20 and 40) and `nearestObjectivePreset` in `magnification.ts`. `zoomToMagnification` zooms about the viewport centre, or a given point, using the slide's microns per pixel |
| Cancellation | Every new camera call cancels the motion in progress. A pointer down or a wheel event on the container stops a flight or a coast before any listener sees it. `stopMotion` is there for keys. A cancelled flight stays where it is and resolves `"cancelled"` |
| No animation | Reduced motion, or an engine that is not mounted, turns flights and eased zooms into cuts and switches coasting off. Unmounting lands a running flight on its target. Since VIEW-045 (camera feel profiles) this is the chosen profile with its motion switched off ([ADR 0106](0106-camera-bounds-and-feel-profiles.md)) |

With curvature √2 the path length of a pan at a fixed zoom is 1.25 for one screen width and 4.24 for ten, and a zoom of three octaves on the spot is 1.47. So a pan of one screen takes about 494 ms and a pan of ten screens or more takes 700 ms. The constant 4 was chosen from that arithmetic, not from a measurement.

## Consequences

- VIEW-021 (wheel, trackpad and pinch handling) maps DOM input to `zoomBy`, `panBy` and the drag calls. The controller binds no DOM events, because which drag pans depends on the tool.
- VIEW-035 (model inference pause during camera motion) can read `getMotion()`. TODO: add a motion subscription if polling per frame is not enough.
- NAV-001 (magnification bar) uses `objectivePresets`, `nearestObjectivePreset` and `zoomToMagnification`.
- DS-016 (motion tokens and reduced motion) should hold the flight durations and easing once the kit names them. The kit names no easing for camera flights, so flights use a cubic ease in and out, the usual default for a camera move. DS-016 can replace it with a named token without changing the controller.
- TODO: the path-length constant and the curvature are not tuned with users. A pilot session could check that flights between areas read as neither slow nor disorienting.
- VIEW-042 (camera bounds at the slide edges) added the POC's rule next to `clampCamera`, so a throw now stops at the edge of the slide ([ADR 0106](0106-camera-bounds-and-feel-profiles.md)).
- The flight path's `r` terms are now computed as `-asinh(b)`, because the `log(sqrt(b² + 1) - b)` form above returned NaN for a flight that zooms far out with a short pan ([ADR 0106](0106-camera-bounds-and-feel-profiles.md)).
