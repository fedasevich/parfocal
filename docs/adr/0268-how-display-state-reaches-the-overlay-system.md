# 0268. The Display panel's state reaches the overlay system through one pure draw function per feature and a controller, and the live slide wiring is still to build

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas (standing approval), written up by Claude
- Backlog: VIZ-000 (research check). Builds on [ADR 0108](0108-overlay-layers-as-typed-data-over-deck-gl.md) (overlay layers as typed data over deck.gl), [ADR 0157](0157-outline-casings-and-overlay-style-sources.md) (outline casings and style sources), [ADR 0158](0158-heatmap-colormaps-and-threshold.md) (heatmap colormaps and threshold), [ADR 0132](0132-display-settings-presets-and-task-locks.md) (display settings, presets and task locks) and [ADR 0233](0233-the-server-keeps-each-reviewer-display-and-stamps-the-preset-on-a-decision.md) (the server keeps each reviewer's display). Covers VIZ-001, VIZ-002, VIZ-003, VIZ-004, VIZ-005, VIZ-006, VIZ-007, VIZ-008 and VIZ-009.

## Context

VIZ-000 asks how result sets, styles and maps are drawn on the overlay system of VIEW-026 (overlay layer system), and how the Display panel's state with its task locks reaches it. Eight of the nine VIZ tasks are ticked, so this records what exists after reading the code on 2026-11-09, and what the last task, VIZ-007 (Display panel), should build on.

What exists is two separate drawing paths.

- The engine path, in `packages/viewer-engine/src/overlay`. Every feature is a pure function from plain settings and plain object lists to typed `OverlayDescription` values. `drawObjectOverlays` (outline, fill or dots, width 1 to 3, opacity 20 to 100, colour by class, score or decision, the score cutoff, the current object's tint), `agreementOverlays` (the three comparisons), `createHeatmapOverlay` with `heatmapStrengthState`, and `createFieldMapOverlay` for the density and confidence maps. `createObjectDrawing` wraps `drawObjectOverlays` around an `OverlayController`, takes the Display panel's string choices (`draw`, `width`, `opacity`, `colorBy`, `cutoff`, `confidence`) and re-registers only the overlays that changed. Goldens in `packages/golden-images/goldens` cover each style, width, opacity, the cutoff, each comparison, each map and each heatmap strength step.
- The screen path, in `apps/web`. The full viewer and guided review draw the mock's `SlideStill` as SVG. `objectStyle` in `screens/viewer/object-draw.ts` repeats the engine's rules in CSS (dashed at half opacity below the cutoff, the score ramp, the decision colours, fill as a colour mix), and `layer-views.tsx` draws the heat, diff and swipe scenes over still images. The only engine overlay mounted on the live slide is `OutlineLayer` (REVIEW-027, outline modes), which calls `createOverlayController` and nothing else.

So the engine can draw everything the Display panel offers and has proof for it, but no screen yet hands the panel's state to it.

## How the panel's state reaches the overlay system

The Display panel keeps the reviewer's settings and the task's locks. ADR 0132 fixes the rules and ADR 0233 fixes where the server keeps them. The rule for the live slide is one-directional.

1. The panel state is resolved first, in `displaySettings` and `withOverrides` in `screens/review/display-tab.tsx`. The order is the panel defaults, then the lab cutoff, then the picked preset, then the task's locks, which win last. Nothing past this step knows what a lock is. A locked value arrives at the engine as an ordinary value.
2. The resolved settings are passed to the engine as `DisplayDrawChoices`, which `drawSettingsFromChoices` validates against the allowed values and clamps. An unknown string falls back to the default, so a stale preset cannot break a draw.
3. The engine redraws only what changed, through the controller. `createObjectDrawing` removes overlays that are no longer produced and sets the rest, `update(layer)` keeps the deck.gl data by identity, and a visibility or opacity change never rebuilds geometry (ADR 0108).
4. The task's scope is never changed by drawing. The cutoff moves objects into the `below` overlay, which is dashed at half opacity, and `DrawnOverlays.scope` still lists every object, as ADR 0132 requires. Hidden classes are the one thing that removes shapes, and they are listed in `hiddenByClass`.

Each group of the panel maps to the engine as follows.

- How objects draw goes to `DrawSettings`. Confidence as colour sets the current object's `tint`, and the other confidence forms are text and need no overlay.
- What the AI shows maps the heatmap strength to a raster overlay's `visible` and `opacity` through `heatmapStrengthState` (off, or 20 to 100 in the steps of `heatmapStrengthSteps`). The score cutoff goes to `DrawSettings.cutoff`.
- Result sets are one vector overlay per set, with an id of its own, so a set can be shown, hidden and removed without touching another. The task's set draws on top and the other sets draw behind it, dashed in their colour (VIZ-001). The z-order table keeps one slot per kind, so two sets of one kind keep registration order, and the order of registration is the rule that puts the task's set above the others.
- The View group draws the comparisons and maps. A comparison is an `agreementOverlays` result, where each agreement kind has a colour and a non-colour cue (solid, dashed, double), so colour is never the only signal. The density and confidence maps are raster overlays in the heatmap slot of the z-order. Swipe and side by side (VIZ-005) are a screen split, not a layer type. Each half is a controller of its own over its own set, and the split position is screen state.
- How the review moves (order, zoom around the object, moving on, button place) is not drawn by the overlay system. It drives the camera and the working set.
- The lock on the other result sets or on a map removes the control's effect on the screen before the engine sees it, so a locked heatmap simply stays at the task's strength.

The preset in force is not an overlay input. It is stamped on each decision by the server from the reviewer's stored display (ADR 0233), and the web does not send it yet.

## What the remaining VIZ work should do

- VIZ-007 (Display panel) builds the panel, its folding summaries, the presets menu and the Shift keys. It must keep `displaySettings` as the single place where locks are applied, and must not add a second place that reads `session.display.locks`. Today `full-viewer.tsx` reads two locks (`other-sets` and `heatmap`) directly for their row reasons, which is fine for the reason text and wrong for the value.
- VIZ-007 should also replace the draft `getTaskDisplay` reading with `getMyDisplay` and the preset operations (ADR 0233), so a reviewer's choice survives a reload and the decision can carry the preset.
- A follow-up task should mount `createObjectDrawing`, the heatmap and map overlays and the comparison overlays on the live slide in `slide-stage.tsx`, next to `OutlineLayer`, driven by the resolved settings above. Until then the SVG stills and the engine disagree only by being two copies of the same rules, so the follow-up should also give `objectStyle` and the engine one shared source for the ramps, the dash and the half opacity. The engine's `scoreColour`, `decisionColours` and `belowCutoffAlpha` are the natural owners, and `object-draw.ts` has its own copies of the score stops and the 0.5 factor.
- Goldens for the live path must compare against the existing `overlay-draw-*`, `overlay-map-*` and `overlay-agreement-*` pictures, so the live slide and the stills cannot drift apart.
- Any new overlay must go through the `overlayStack` table and a constructor that takes its order from the kind, never a caller's own number (ADR 0108).

## Options considered

1. Let each screen build its own overlays from the panel state. The screens would repeat the rules and drift, which the SVG copy of `objectStyle` already does in a small way.
2. One pure draw function per feature in the engine, and a controller that applies the result. The rules live once, are tested in Node, and a second renderer route can reuse them.
3. Send the panel state to the engine and let the engine resolve presets and locks. The engine would learn about tasks and the API, which it must stay free of.

## Decision

Option 2. Presets and locks are resolved in the web layer, the engine receives plain values, and the live slide takes them through `createObjectDrawing` and the other draw functions.

## Consequences

- No code changes in this task. VIZ-000 closes with this record.
- A follow-up backlog task is due for mounting the engine draws on the live slide and sharing the style constants with the stills. It is not a VIZ-007 blocker, because the panel can be finished against the SVG stills first, but VIZ-007's browser tests would then prove the panel and not the live draw.
- The lead should check that the live slide is not claimed as done by VIZ-008 (how objects draw on the live slide). Its commit added the engine adapter and a harness, not a mount in the app.
