# 0048. Routing with TanStack Router and Zod search params

- Date: 2026-10-15
- Status: Accepted
- Deciders: Yurii Fedas (owner standing approval)
- Backlog: STACK-003 (routing), touches STACK-005 (client UI state, where URL state lives in the router)

## Context

The web app is a React 19.3 SPA with React Compiler on ([ADR 0016](0016-react-19-spa-compiler-strictmode.md)), built with Vite 8 ([ADR 0015](0015-vite-build-tool.md)) and compiled with TypeScript 7 under strict flags including `exactOptionalPropertyTypes` and `nodenext` module resolution ([ADR 0006](0006-monorepo-tooling.md)). Zod 4 is the schema library ([ADR 0045](0045-forms-and-validation.md)). The backlog says that worklist filters, case view state and deep links to a view all live in the URL. The model route is `/case/:caseId/slide/:slideId?x=&y=&z=`, where the search params carry a viewport position and level that must be validated before a screen reads them.

Two facts shape the choice. A wrong type in a link or in a read of the URL should fail typecheck, because the URL is a public contract that colleagues paste into chat. And the viewer engine lives outside React ([ADR 0016](0016-react-19-spa-compiler-strictmode.md)), so the router only has to carry the state and never drive frames.

The spike numbers are in [results/2026-10-15-routing-spike.md](../results/2026-10-15-routing-spike.md). Versions were checked on 2026-10-15. The backlog named React Router 7, and the npm `latest` tag is now 8.4.0, so the spike built the same source against both 7.18.4 and 8.4.0.

## Options considered

1. TanStack Router 1.170.44 with its Vite plugin 1.168.46. Route params and search params are typed from the route tree. The `validateSearch` option accepted a Zod 4 schema directly, with no adapter package. In the spike it typechecked under TypeScript 7.0.2 with the repository flags and rejected a string for `x`, a missing `slideId` and an unknown search key on `<Link>`. `autoCodeSplitting` produced a separate 668-byte route chunk. The main chunk grew by 27,216 bytes gzip over a React DOM and Zod baseline. Costs: a generated `routeTree.gen.ts` file, and a silent failure under `nodenext` unless the plugin option `addExtensions` is true. Without it the generated file's imports did not resolve, the file is `@ts-nocheck`, and all route typing quietly became `any`. The spike only noticed because a deliberately wrong file still passed.
2. React Router 7.18.4 in library mode. It is the most familiar router and its `lazy` route option gave a separate 843-byte chunk. It has no search param validation, so the spike wrote a Zod `safeParse` helper and a URL builder, and a hand-written `Register` declaration to give `href()` typed path params. Wrong calls through those helpers failed typecheck. A raw `<Link to="/case/c1/slide/s1?x=left">` and a misspelled path both typechecked. The main chunk grew by 30,553 bytes gzip. Query values are strings, so the schema needs `z.coerce`, which turns an empty `x=` into 0.
3. React Router 8.4.0 in library mode. The spike code compiled and behaved the same as with 7.18.4, with a main chunk 30,394 bytes gzip over the baseline. Its typing story in library mode is the same as option 2. The fully generated route types of React Router belong to its framework mode, which this SPA does not use.

Both libraries typechecked in 0.37 to 0.39 seconds on the spike, so typecheck speed does not separate them.

## Decision

| Concern | Choice |
|---|---|
| Router | TanStack Router 1.x with file-based routes and the Vite plugin |
| Search params | Validated by a Zod 4 schema passed to `validateSearch`, with defaults for optional keys |
| Code splitting | `autoCodeSplitting: true` for route components |
| Plugin setting | `addExtensions: true`, required under `nodenext` |
| Router registration | The `Register` interface with the router type, so every `Link`, `navigate` and `useSearch` is typed |
| Typecheck guard | One deliberately wrong file, kept as a test, must produce errors, so a broken route tree cannot pass silently |

TanStack Router wins because it gives the typed search params that the backlog asked for as a property of the router, and wrong URLs fail at the call site wherever the developer writes them. React Router in library mode reaches the same checks only through project code that a developer can bypass with a plain string link. The size difference is 3.3 KB gzip from one build of a toy app, so it supports no claim either way (results file). The backlog default also named TanStack Router.

What did not win by a wide margin. React Router is the older and more familiar library, and its 8.x line is current. The typed layer the spike wrote for it was small, and a lint rule might close the raw-string gap, which was not tested. Search param validation in TanStack's `validateSearch` also runs in the main chunk, so Zod is not lazy in either design.

## Consequences

- The first screen task adds `@tanstack/react-router` and `@tanstack/router-plugin` to `apps/web` with exact versions, and wires the plugin in `vite.config.ts` before the React plugin, with `autoCodeSplitting: true` and `addExtensions: true`. No dependency was added by this decision.
- `routeTree.gen.ts` is generated. Whether it is committed or generated before typecheck in CI is open (TODO in the results file). It must exist before `pnpm typecheck` can see route types.
- A slide route lives in a file named `case.$caseId.slide.$slideId.tsx` with a Zod schema in a separate module, so the same schema can be imported by tests and by link-building code. The schema keeps `x` and `y` within 0 to 1 and `z` as an integer, with defaults, as in the spike. The real bounds depend on the viewer engine (STACK-006) and are not decided here.
- Invalid search params put the route in an error state in the spike. The screen task decides between an error component and `.catch()` to fall back to defaults. The viewer link case is likely to want the second, which was not tested.
- STACK-005 (client UI state) can say that URL state lives in the router. Filters, case view and viewport deep links go through `validateSearch`, and nothing in a Zustand store duplicates them.
- Component code that destructures with default values, such as `const { a = "" } = props`, makes React Compiler 1.0.0 skip the component. This is not specific to the router. It should reach `docs/knowledge/` at the next consolidation.
- The spike used no browser. Navigation behaviour, the bare URL case, render counts on search changes and the lazy chunk request are open items in the results file. The viewer will change `x`, `y` and `z` often, so render counts should be measured before the viewer screen is built.
- The backlog line for STACK-003 can be ticked once the log entry is written.

Package versions and peer ranges come from the npm registry and the installed packages on 2026-10-15.
