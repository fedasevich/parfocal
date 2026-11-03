# 0182. The shell keeps TanStack Router with Zod search params and the one-home state rule, with no upgrade due

- Date: 2026-11-03
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: SHELL-000 (research check for the application shell). Confirms STACK-003 (routing, [ADR 0048](0048-routing.md)) and STACK-005 (client UI state, [ADR 0143](0143-client-ui-state-zustand-and-xstate.md)) for the SHELL epic.

## Context

The SHELL epic builds the global top bar and sidebar, the slide top bar, the workspaces, the inspector panel, the palette and the account menu. Two earlier records shape it. [ADR 0048](0048-routing.md) chose TanStack Router with file routes, Zod search params, automatic code splitting and `addExtensions`. [ADR 0143](0143-client-ui-state-zustand-and-xstate.md) gave every kind of client state one home: Query for server data, search params for shareable views, the engine for frame values, Zustand for shared UI state, XState for real machines and the settings layers for preferences.

What the shell code does today, read on 2026-11-03 in `apps/web`:

- `@tanstack/react-router` 1.170.46 and `@tanstack/router-plugin` 1.168.48 are pinned. `vite.config.ts` runs the plugin with `autoCodeSplitting: true` and `addExtensions: true`. `router.ts` registers the router type, and `routeTree.gen.ts` is committed, which settles the open item ADR 0048 left about the generated file.
- 28 route files use `validateSearch`. The root route validates the shell overlays (`open` for the palette or notifications, `find` and `as`) through `shell/overlays.ts`, and opening them writes with `replace`.
- `test/routes.test.ts` typechecks `test-types/wrong-links.tsx` and asserts that a misspelled path, a missing param, a wrong search type, an unknown search key and an unknown search value all fail. This is the guard ADR 0048 asked for.
- The slide routes moved from the spike's `case.$caseId.slide.$slideId` to `projects.$projectId.slides.$slideId` with sibling workspace routes, as [ADR 0176](0176-case-view-state-model.md) records.
- No Zustand or XState package is installed. Shared shell state still lives in React context with `useState`: the jobs tray in `shell/jobs-tray.tsx` and the folded sidebar in `shell/sidebar-toggle.tsx`, with `navOpen` held in `shell/global-shell.tsx`. Theme, developer mode and the pinned strip read and write `localStorage` directly in `shell/theme.ts`, `shell/developer-mode.ts` and `shell/pinned-strip.ts`.

Current releases were read from the npm registry on 2026-11-03.

| Package | Pinned | npm `latest` | Last published |
|---|---|---|---|
| `@tanstack/react-router` | 1.170.46 | 1.170.46 | 2026-10-22 |
| `@tanstack/router-plugin` | 1.168.48 | 1.168.48 | 2026-10-22 |
| `zod` | 4.6.7 | 4.6.7 | 2026-10-12 |
| `zustand` | not installed | 5.0.16 | 2026-10-22 |
| `xstate` | not installed | 5.33.3 | 2026-11-02 |
| `@xstate/react` | not installed | 6.1.0 | 2026-11-02 |
| `react-router` | not used | 8.5.1 | 2026-10-27 |

TanStack Router has no new major line on npm: its `beta` tag is `0.0.1-beta.286` and its `pre` tag is `1.170.19-pre.0`, both older lines. Its React peer range accepts React 19, and so do those of Zustand and `@xstate/react`. A web search for newer TanStack Router releases found only GitHub releases up to September 2026, so the registry is the source for the table. Nothing was installed or measured.

## Options considered

1. Keep both records unchanged for the shell. The router is current and its guard test passes in CI, and the state rule needs no package until a store or a machine is needed.
2. Move to React Router 8. Its library mode still lacks validated search params, which ADR 0048 rejected it for, and the move would rewrite 28 routes and the overlay search. Nothing in the shell asks for it.
3. Move the shell's context state into Zustand now. It is cheap, but ADR 0143 asks for the move when a task next changes that code, and SHELL-002 (global top bar and sidebar) and SHELL-005 (inspector panel) are those tasks.

## Decision

Option 1. STACK-003 and STACK-005 stand for the shell as written, with these rules for the SHELL tasks.

| Shell state | Home |
|---|---|
| Route, project, slide, workspace, tab, filters and the open overlay (palette, notifications) | Path and Zod search params, written with `replace` when only a view changes |
| Sidebar folded or open, jobs tray open, inspector open and width during the session | One Zustand store for the shell, added by the first SHELL task that changes this state |
| Theme, inspector width and other values kept between visits | The settings layers of [ADR 0138](0138-settings-catalogue-in-python-resolved-in-the-browser.md), not `localStorage` helpers and not Zustand `persist` |
| Menus, popovers and input drafts | Local component state |
| Workspace counts, jobs, notifications and the account | TanStack Query |

No shell flow needs XState. The slide top bar popovers and the workspace switch have fewer than three states and no guard, so they stay local or in the store.

## Consequences

- No upgrade is due, so no backlog task is added. Each task that adds `zustand` checks the version again, as ADR 0143 says.
- SHELL-002 (global top bar and sidebar) moves the folded sidebar and `navOpen` into the shell store, and the first task that changes the jobs tray moves it too.
- SET-002 (settings modal shell) moves `theme.ts`, and the developer mode and pinned strip helpers follow it onto the device layer.
- SHELL-004 (workspaces Review and Annotate) keeps the camera in the URL and the engine, so a workspace switch reads no store value for it.
