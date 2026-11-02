# 0143. Client state has one home per kind: Query for server data, the router for links, the engine for frames, Zustand for shared UI state and XState for real state machines

- Date: 2026-11-02
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: STACK-005 (client UI state). Touches SHELL-005 (inspector panel with resize and hide), NAV-006 (smart minimap state machine), STACK-006 (viewer hot-path state outside React) and SET-001 (settings schema and layers).

## Context

Three homes are already decided. Server state lives in TanStack Query on the generated client ([ADR 0049](0049-server-state-and-data-fetching.md)). Filters, case view and deep links live in typed router search params ([ADR 0048](0048-routing.md)). Camera, pointer and tool hot state live in the framework-free engine and reach React through `useSyncExternalStore` ([ADR 0100](0100-viewer-hot-path-state-outside-react.md)). Settings resolve in the browser through lab locked, personal, device and default layers, with device values in the browser's storage ([ADR 0138](0138-settings-catalogue-in-python-resolved-in-the-browser.md)).

What is left is UI state that several screens or panels share without the server: which panels are open, the active tool family, the workspace layout, the current selection, the jobs tray. Today the shell holds it in React context with `useState` (`jobs-tray.tsx`, `sidebar-toggle.tsx`) and the theme in a hand-rolled `localStorage` helper (`theme.ts`). Context re-renders every consumer on every change, which will not scale to the review workspace. A few flows are real machines with named states and guarded transitions: the smart minimap (hidden, reading, area, locator, travel, faded, peek), the review loop and the one-click prompt flow. The app runs React 19 with React Compiler under StrictMode ([ADR 0016](0016-react-19-spa-compiler-strictmode.md)).

Versions were checked with `npm view` on 2026-11-02 and nothing was installed or measured.

## Options considered

| Option | For | Against |
|---|---|---|
| Zustand 5.0.16 | Small store with selector hooks built on `useSyncExternalStore`, so it fits React Compiler and never tears. Vanilla stores work outside React. The backlog default | Selectors that return a new object need `useShallow`, or they re-render on every change |
| Jotai 3.0.1 | Atoms give fine-grained updates and derived values | State spreads across many atoms with no single place to read a feature's state, and a second model next to Query's own atoms of data |
| Redux Toolkit 2.13.0 | Devtools, strict one-way flow | Most boilerplate, and its cache overlaps Query |
| Context with `useReducer` only | No dependency | Every consumer re-renders on every change, and each feature rebuilds a provider |
| XState 5.33.3 with `@xstate/react` 6.1.0, for machines only | Named states, guards and a model that model-based tests can walk | Heavy for a toggle, so it is worth it only for a real machine |
| A hand-written reducer for machines | No dependency | Guards and timers by hand, and nothing to generate test paths from |

## Decision

Each kind of state has exactly one home, and no value is copied into a second one.

| Kind | Home | Rule |
|---|---|---|
| Server data | TanStack Query ([ADR 0049](0049-server-state-and-data-fetching.md)) | Never copied into a store. A store holds IDs and reads the record from Query |
| Anything a colleague should be able to paste and see the same | Router search params ([ADR 0048](0048-routing.md)) | Worklist filters, the open case, slide and viewport, the active compare layout |
| Values that change on frames | The engine, read with `useSyncExternalStore` ([ADR 0100](0100-viewer-hot-path-state-outside-react.md)) | Camera, pointer, drag and tool hot state. A store may hold a value only if it changes on a user action, never per frame |
| UI state shared across screens or panels | Zustand, one store per feature | Panels open and their widths during the session, the active tool family, the selection, the jobs tray |
| Flows with named states, guarded transitions and more than one exit | XState, one machine per flow | The smart minimap, the review loop and the one-click prompt flow. A flow with fewer than three states or no guard stays a Zustand store or local state |
| Preferences kept between visits | The settings layers ([ADR 0138](0138-settings-catalogue-in-python-resolved-in-the-browser.md)) | Theme, inspector width and other device or personal values. Zustand's `persist` is not used, so a stored value always has a schema and a scope |
| State of one component or one subtree | `useState` or `useReducer` | Open menus, input drafts and hover, kept local while one subtree owns it |

Zustand stores are created with `create` in `apps/web` and read only through selectors that return a primitive or go through `useShallow`. The engine never imports Zustand. When the engine must follow a store value such as the active tool, `apps/web` subscribes to the store and calls the engine's own setter. Machines run with `useActor` or `createActor` and keep frame values out of their context.

Zustand wins over Jotai and Redux Toolkit because it gives one readable store per feature with the least code and no overlap with Query. XState wins over hand-written reducers only where NAV-006 (smart minimap state machine) asks for model-based tests that drive every transition.

## Consequences

- No package is added by this task. The first task that needs a shared store adds `zustand`, likely SHELL-005 (inspector panel with resize and hide), and NAV-006 (smart minimap state machine) adds `xstate` and `@xstate/react`. Each checks the version again then.
- The shell's context state in `jobs-tray.tsx` and `sidebar-toggle.tsx` moves into a Zustand store when a task next changes it, and `theme.ts` moves onto the device settings layer with SET-002 (settings modal shell). Nothing moves now.
- A review that sees a server value in a store, a frame value in a store or a shareable view in a store asks for it to move.
