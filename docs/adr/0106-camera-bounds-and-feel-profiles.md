# 0106. Camera bounds follow the slide, and one live profile holds every camera tunable

- Date: 2026-10-23
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-042, VIEW-045. Touches VIEW-021, VIEW-022, VIEW-033, VIEW-046, SET-006 and DS-016.

## Context

VIEW-042 (camera bounds at the slide edges) asks for the POC's zoom range, from half the fitted size to 16 device pixels per level-0 pixel, held in one place, a view centre that stays on the slide, coasts that stop on the axis that hits an edge, and a re-clamp on resize and on a slide switch. VIEW-045 (camera feel profiles) asks for one typed profile that the controller reads live, with the presets Smooth (the POC's values), Precise and Instant, reduced motion forcing Instant, and a profile switch mid-motion that neither jumps nor leaves a motion running.

The POC's `viewport.ts` held the range in `scaleRange` with `MIN_SCALE_FACTOR` 0.5 and `MAX_SCALE` 16 in device pixels, and its `clampCamera` kept the centre inside the extent. Its controller zeroed the velocity of an axis that the clamp moved and abandoned a zoom target the clamp rejected (POC doc 06 §17). Our camera is in CSS pixels, and [ADR 0104](0104-camera-controller-motion.md) left the centre unclamped and the tunables as module constants.

A smoothness suite added with this work drives the engine at 30, 60 and 120 Hz and with jittery frame times and compares each run with a run at 1 ms frames. Several choices below came out of what it showed.

## Options considered

How the limits reach the camera:

1. Keep one fixed `ZoomLimits` per engine and add a second clamp for the centre. Two places would hold the limits again, which is the POC's drift bug.
2. One function, `cameraBounds`, turns the slide, the viewport size and the device pixel ratio into the zoom range and the extent. `clampCamera` applies it, and both the engine and the controller read the same value. A caller's `zoomLimits` only narrows it.

What a profile switch does to a running motion:

1. Land the motion on its target at once. It honours the request but jumps.
2. Keep every running motion under its old settings until it ends. Nothing jumps, but a switch to Instant leaves a coast or a flight running.
3. Catch the motion up to the switch time, then let it continue under the new settings if the new profile still animates it, and stop it where it is if not. A stopped flight resolves `cancelled`. A running flight keeps its planned duration, because a new duration would change its progress and jump.

What reduced motion does to a custom profile:

1. Replace it with the Instant preset. Any wheel rate or zoom anchor the person set in SET-006 (navigation and devices section) would be lost while reduced motion is on.
2. Keep the profile and switch off its motion only, meaning coasting, zoom easing and flights. Instant is defined the same way, as Smooth with its motion switched off.

When a coast ends:

1. When its speed falls under 0.01 px/ms, as in the POC and ADR 0104. The check runs at frame times, so the coast covers up to 1.3 px more or less depending on the frame rate.
2. At the time the speed would reach 0.01 px/ms, computed from the release speed and the decay, with the last step integrated exactly up to that time. The end position is then the same at every frame rate.

## Decision

Option 2 for the limits, option 3 for a profile switch, option 2 for reduced motion and option 2 for the end of a coast.

| Concern | Rule |
|---|---|
| Zoom range | `cameraBounds` in `src/camera/camera.ts`. Minimum zoom is the fitted zoom minus one octave (`zoomOutShareOfFit` 0.5). Maximum zoom is `log2(16 / devicePixelRatio)` (`maxDevicePixelsPerSlidePixel` 16), so 16 device pixels per level-0 pixel on any screen. A slide too small to zoom out on gets one zoom, the deepest. Without a viewport the floor is the caller's minimum or `defaultZoomLimits`. Without a slide the caller's limits or the defaults apply |
| Centre | `clampCamera` keeps `x` in `[0, width]` and `y` in `[0, height]` of the slide |
| Engine | Caches the bounds and drops the cache on mount, unmount, resize, slide open and slide close. A resize or a slide close re-clamps the camera, and a slide open fits it. The device pixel ratio is the `devicePixelRatio` option, read from the window by default |
| Walls | A coast step that the clamp moves on an axis zeroes that axis's velocity. A release pressed against a wall drops that axis before the coast starts, and does not coast at all when both axes are pressed |
| Unreachable zoom | An eased zoom stops as soon as the applied zoom differs from the one it asked for, for example after a resize raised the minimum |
| Profile | `CameraProfile` in `src/camera/profile.ts` holds the velocity window, release idle time, minimum throw speed, coast decay, zoom ease, flight bounds and path length, wheel and pinch rates in octaves per pixel, the per-event zoom cap, the keyboard pan step and the zoom anchor (`cursor` or `centre`). `wheelZoomOctaves` turns wheel or pinch travel into a capped zoom step for VIEW-021 (wheel, trackpad and pinch handling) |
| Presets | `cameraProfiles.smooth` is the default with the POC's values: 70 ms window, 60 ms idle, 0.04 px/ms, 130 ms decay, 55 ms ease, 400 to 700 ms flights, 0.0022 and 0.0075 natural-log units per pixel for wheel and pinch, and a 120 px key step. `precise` has no coasting and halves the zoom ease and both flight bounds. `instant` is `withoutMotion(smooth)` |
| Live switch | `engine.setCameraProfile` and `controller.setProfile` follow option 3 above. `getCameraProfile` returns the chosen profile, not the reduced-motion one |
| Inputs | Every camera input first advances the running motion to the input's time, so a wheel step, a pan or a cancel acts on the same state at any frame rate |
| Frames | A camera change made inside the engine's frame no longer requests another frame, and a flight ends on the frame where its sample equals its target. The frame loop stops on the frame that lands the motion |

The per-event cap is half an octave because VIEW-021 says so. The POC capped an event at 0.45 in natural-log units, which is about 0.65 of an octave. The Precise values are halves of Smooth's, chosen as a rule rather than measured.

## Consequences

- VIEW-021 (wheel, trackpad and pinch handling) reads the rates and the cap from `engine.getCameraProfile()` through `wheelZoomOctaves` and calls `zoomBy`. The controller's method names are unchanged, and it gained `profile` and `setProfile`. The controller host's `limits` field became `bounds`, a function.
- VIEW-022 (keyboard navigation) takes its pan step from `keyPanStepPx`. The held-key easing it asks for is not in the profile yet.
- SET-006 (navigation and devices section) maps the settings onto a `CameraProfile` and calls `setCameraProfile`.
- VIEW-033 (hidden tab and background scheduling) can settle through the existing `settle()`. Inputs already catch a motion up to their own time.
- VIEW-046 (objective detents on wheel zoom) adds its hold length to the profile.
- DS-016 (motion tokens and reduced motion) can replace the Smooth durations with named tokens without touching the controller.
- The flight path now uses `-asinh(b)` for the van Wijk and Nuij `r` terms. The old `log(sqrt(b² + 1) - b)` form returned NaN for a flight that zooms far out with a short pan, such as one from 16 screen pixels per slide pixel out to 1/512 with a pan of 10 slide pixels.
- A van Wijk flight that would zoom out past the minimum is flattened there by the clamp. It does not jump, but its zoom speed has a kink at the floor. TODO: plan the flight inside the zoom range if a pilot session notices it.
- TODO: the Precise values, and whether Smooth's 0.5 octave cap feels right with the POC's rates, need a manual check with a mouse and a trackpad, recorded as a result file.
