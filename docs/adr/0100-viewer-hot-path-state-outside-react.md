# 0100. Viewer hot-path state lives in the engine and React reads it through useSyncExternalStore

- Date: 2026-10-23
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-006, VIEW-001. Touches STACK-005, VIEW-020, VIEW-030, VIEW-036 and VIEW-003.

## Context

The camera changes on every animation frame while a pathologist pans, zooms or flies to an object. POC doc 24 showed how much a viewer loses when per-frame work leaks onto the main thread: forced layouts from `getBoundingClientRect` on every pointer move, a debug string built per tile, three idle loops at 60 Hz. React adds one more way to lose frames, because a component that holds the camera in state re-renders on every frame. POC doc 30 split the POC's 3,602-line `main.ts` into controllers around a renderer that owned the routes, and `packages/viewer-engine` was set up as a framework-free package for the same reason ([ADR 0008](0008-typescript-internal-packages.md)).

STACK-006 asks which state mechanism carries the camera and the other hot state from the engine to React, with React never re-rendering on camera frames. The web app is React 19 under StrictMode with React Compiler ([ADR 0016](0016-react-19-spa-compiler-strictmode.md)).

The spike used the Viv and deck.gl versions the POC uses: Viv 0.22.1, deck.gl 9.3.11 and luma.gl 9.3.6. STACK-015 (Viv and deck.gl versions), which [ADR 0098](0098-viv-and-deck-gl-versions.md) records, may change them. Nothing in this decision depends on the versions, because React never sees deck.gl.

## Options considered

1. A plain observable in the framework-free engine. The engine owns the camera as an immutable value, exposes `getCamera` and `subscribeCamera`, and React reads it with `useSyncExternalStore` and a selector that returns a primitive. No dependency, works with any renderer, and `useSyncExternalStore` is React's supported way to read an external store without tearing. Every consumer must remember to select, because reading the whole camera re-renders once per camera change.
2. Signals, either Preact signals through `@preact/signals-react` or the TC39 signals polyfill. Fine-grained updates and computed values. `@preact/signals-react` needs a Babel transform or a `useSignals` hook in every component and depends on React internals, which sits badly next to React Compiler. The TC39 proposal is at stage 1 and its polyfill is not meant for production. Either would put a reactive library inside the engine or a second state model in the app.
3. A Zustand vanilla store inside the engine. A familiar `getState` and `subscribe` API and selector hooks, and STACK-005 already plans Zustand for UI state. It notifies synchronously on every `setState`, so per-frame batching would still have to be built around it, and the engine would gain a dependency for about 30 lines of code.

Options 2 and 3 were compared on their documentation and their fit with ADR 0016, not measured.

## Decision

Option 1. The spike showed it meets the goal with nothing added, and options 2 and 3 offer nothing the engine needs.

| Concern | Rule |
|---|---|
| Owner | `createViewerEngine` in `@parfocal/viewer-engine` owns the camera, the open slide, the registered overlays and the renderer route. React owns none of them |
| Reading the camera | `useSyncExternalStore(engine.subscribeCamera, () => select(engine.getCamera()))` where `select` returns a primitive or a value that keeps its identity, such as the zoom rounded to what the inspector shows |
| Notification rate | The renderer gets every camera change at once. Camera subscribers hear at most once per animation frame, and not at all while the camera stands still |
| Snapshot identity | `getCamera` returns the same object until the camera changes, which `useSyncExternalStore` requires |
| Unbound methods | Engine methods are closures, so `engine.subscribeCamera` can be handed to React without `bind` |
| Writes | React and controllers write through `setCamera`, `openSlide`, `registerOverlay` and the other engine calls. Pointer input reaches controllers as engine events in slide coordinates, outside React |

In the [spike](../results/2026-10-23-hot-path-state-spike.md) a React inspector showing the magnification over CMU-1.svs in Viv rendered 0 times in every pan, against 120 or 180 renders in the same pans when it read the whole camera. Pointer pans ran at 60 fps with and without a 4x CPU throttle.

## Consequences

- VIEW-001 (engine package API) implements this in `packages/viewer-engine/src/engine` and `src/camera`, with the renderer route and the slide opener injected behind small interfaces.
- The web app gets a `useViewerCamera(engine, select)` hook when the viewer page is built. TODO: add a render-count test there that pans and expects no inspector renders, so a later component that reads the whole camera is caught.
- STACK-005 (client UI state) keeps the viewer hot state out of Zustand. Zustand can hold what the inspector shows only if the value changes on user actions, not on frames.
- VIEW-020 (camera controller) builds on the engine's pointer events and `setCamera`, without React.
- VIEW-036 (renderer interface) grows from the `RendererRoute` interface used here, and VIEW-003's PixelSource reaches the engine through the slide opener.
- A fast cold pan under a 4x CPU throttle ran at 24 to 32 fps in both modes. That cost is tile loading in the spike's minimal slide source, not React, and belongs to VIEW-004 (decode worker pool) and STACK-015.
