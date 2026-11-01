# 0135. Fake data goes through the API client, with Orval's MSW handlers and draft hooks named as Orval will name them

- Date: 2026-11-01
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: closes PROTO-000 (research check for the fake data layer), changes PROTO-002 (fake data layer for the app and the catalogue), confirms [ADR 0129](0129-the-prototype-moves-into-react-as-the-design-source.md) (the prototype moves into React and becomes the design source) and refines how its screens with no API get their fake data

## Context

[ADR 0129](0129-the-prototype-moves-into-react-as-the-design-source.md) builds every mock screen in `apps/web` over fake data served by MSW, with Orval generating the handlers for operations the API has and hand-written fixtures for the rest. The owner's main goal for that layer is that a screen built now on fake data connects to the real backend later with almost no change. [ADR 0049](0049-server-state-and-data-fetching.md) (TanStack Query v5 on the generated client) already says the generated Orval hooks are the only way screens reach the API. The client is generated from `openapi.json` by Orval 8.40.0 in `single` mode with the `react-query` client, `fetch` and the `apiFetch` mutator ([ADR 0017](0017-orval-api-client.md)), and CI fails when regeneration changes anything under `packages/api-client`. Web code may read only `PARFOCAL_PUBLIC_*` variables, which a Vite plugin enforces.

Versions were checked on 2026-11-01. MSW is at 3.0.3, `@faker-js/faker` at 10.6.0, `msw-storybook-addon` at 3.0.3 with peers `msw >=2` and `storybook ^9 || ^10 || ^11`, and Orval at 8.46.0.

What the spike found.

| Question | Finding |
|---|---|
| Can Orval emit MSW handlers next to the react-query client and the mutator? | Yes. `mock: { generators: [{ type: "msw" }] }` in `single` mode leaves `api.ts` byte for byte the same and writes a sidecar `api.msw.ts` with a `get<Op>MockHandler` and a `get<Op>ResponseMock` per operation and `getParfocalAPIMock()` for all of them. `mock: true` also writes `api.faker.ts`, whose factories duplicate the ones inside `api.msw.ts`, so the MSW generator alone is enough |
| Does the sidecar compile under `nodenext`? | Not as generated. It imports `./api` without an extension although the config sets `allowImportingTsExtensions`, and Orval 8.46.0 does the same, in `split` mode too. A small step in the `generate` script adds `.ts` to relative imports in the sidecar, and a test fails if the committed file lacks it |
| Does the generated code work with MSW 3? | Yes. The migration guide moves `http`, `HttpResponse` and `delay` to subpaths, but the 3.0.3 root entry still exports them, so the generated `from "msw"` imports work unchanged. `onUnhandledRequest` is now `onUnhandledFrame` |
| How is the service worker served? | `msw/vite` serves `mockServiceWorker.js` from the dev server. In its `worker-only` mode it also emits the worker into every build, so the app applies it only to `vite serve`, and nothing is committed to `public/` |
| Is the generation stable for the CI check? | Yes. Two runs of `pnpm api:generate` gave identical files |

## Options considered

1. Hand-written fixtures in `apps/web` with a draft type, as PROTO-002 first said. Each screen imports its fixture or a local fake hook. It is quick, but wiring a screen means changing its data access, and nothing ties a fixture's shape or name to the operation the backend will ship.
2. A fake mode of the real backend, seeded with the scenario. The contract is real, but every planned operation needs backend code before a screen can show it, Storybook cannot use it, and the prototype then waits on the backend.
3. Fake data behind the API client. Screens import data hooks only from `@parfocal/api-client`. Operations the API has use the generated hooks, answered in fake mode by the generated MSW handlers with the scenario seed in front. Operations the API lacks get a hand-written draft hook in `packages/api-client/src/draft/` named exactly as Orval will name it, with a Zod schema for the response and an MSW handler on the planned URL. Wiring is regenerating and deleting the draft. It costs a naming discipline and a test that keeps drafts and generated names apart.
4. Hand-written MSW handlers for every operation. It works for operations that do not exist yet, but the handlers drift from `openapi.json` because nothing types them.

## Decision

Option 3, because it is the only one where wiring a screen to the backend changes no screen code.

- Screens import data hooks only from `@parfocal/api-client` and never call `fetch` themselves.
- Orval generates `src/generated/api.msw.ts` next to `api.ts` with the MSW generator, and the `generate` script adds the missing import extensions before Biome formats the output.
- Fake code is reached only through the `@parfocal/api-client/fake` subpath for handlers and the seed and `@parfocal/api-client/fake/browser` for starting the worker, never through the main entry, so nothing on the app's normal import path pulls in MSW or faker. The worker start has its own subpath because `msw/browser` refuses to load in Node, where the handler tests run. `msw` and `@faker-js/faker` are dependencies of the API client package, and the app and Storybook start the worker through it, so handlers and worker always come from one copy of MSW.
- A draft hook for a planned operation lives in `src/draft/` and is exported from the main entry. It uses the planned operationId and URL and mirrors the generated names, `use<Op>`, `get<Op>QueryKey`, `get<Op>QueryOptions` and the `<op>` fetch function, with the same `{ data, status, headers }` envelope through `apiFetch`. Its response type is inferred from a Zod schema, which also checks the fake body. Its handler, `get<Op>MockHandler`, lives under the fake subpath. A unit test fails when a draft name is also generated, and another fails when a draft's planned path appears in `openapi.json`, so a forgotten draft is caught the day its route ships. The backend then ships the route, the client is regenerated, the draft and its handler are deleted, and every import keeps its name.
- One scenario seed under the fake subpath holds the mock's people, workspace, projects, cases, slides, result sets, review tasks and object IDs such as `P07/S26-04812/A1/T2·C145`. Seed handlers go in front of the generated ones, so a seeded operation tells the scenario's story and every other operation still answers with typed faker data from a fixed faker seed. None of it is real patient data.
- `PARFOCAL_PUBLIC_FAKE_API` switches the layer. `off` is the default and sends every call to the API. `all` answers every call with fake data. `drafts` answers only draft operations and sends the rest to the local API through the dev proxy. Config refuses any value but `off` in staging and production, and the app imports the fake layer only inside `import.meta.env.DEV`, so production and staging builds drop it whatever the variable says. A build test checks that those bundles hold no MSW code and no worker script.
- In `pnpm dev` the worker starts before the app renders. Storybook starts the same handlers through `msw-storybook-addon`.
- A small badge shows on every screen that still shows fake data, which is every screen in `all` mode and, in `drafts` mode, any screen with an active draft query. The badge is part of the fake layer, so production builds do not contain it.

## Consequences

- PROTO-002 (fake data layer for the app and the catalogue) builds the router, the Query provider, the seed, the first draft, the badge and Storybook on this layer. Its text now says draft hooks live in `packages/api-client` instead of fixtures in `apps/web`.
- Each feature UI task that wires a screen deletes the screen's draft hooks and handlers, regenerates the client and removes the operations from the seed only if the seed no longer needs them. The screen's imports do not change.
- The generated sidecar adds about 0.37 MB of source to `packages/api-client`, and Biome reports it as infos the same way it already reports `api.ts`.
- If Orval starts adding the import extension itself, the fix step becomes a no-op and can be removed. Its test keeps passing either way.
- A draft has to guess the planned operationId and URL. A wrong guess costs one import rename when the route ships, which the collision and path tests make visible.
