# Components, styling and the catalogue

How `packages/ui` and `packages/tokens` are put together, as [ADR 0130](../adr/0130-shadcn-ui-on-base-ui-with-tailwind-v4.md) (shadcn/ui on Base UI with Tailwind CSS v4) decided and DS-000 (design system tooling check) set up.

## Adding a shadcn component

Run `pnpm --filter @parfocal/ui shadcn:add <name>`, then `pnpm --filter @parfocal/ui shadcn:adopt`, then `pnpm exec biome check --write packages/ui`. `components.json` uses the `base-nova` style, so components come from the Base UI base. Its aliases point at `@parfocal/ui/components` and friends, which resolve through the package's own `exports` and the `paths` entry in `packages/ui/tsconfig.json` that only the shadcn CLI reads. The CLI also adds the component's registry dependencies, so `combobox` brought `input`, `textarea` and `input-group`, and `toggle-group` brought `toggle`. If it adds an npm dependency, it writes a `^` range into `package.json`. Pin it back to an exact version before committing. Add a story for the new component, because the axe suite only covers what has a story. Source: DS-000 log entry of 2026-11-01.

## The adopt script strips comments and renames clashing classes

`packages/ui/scripts/adopt.ts` parses each file in `src` and `stories` with oxc-parser and removes every comment, including JSX comments in empty `{}` containers. It parses the result again and stops if the file no longer parses. It also renames three shadcn class names that mean something else in the kit: `bg-accent` becomes `bg-chrome-2` (the kit's hover surface for menu items), `text-accent-foreground` becomes `text-fg`, and `text-primary` becomes `text-accent`, because `primary` is the accent fill and failed contrast as link text on the dark page. `test/adopt.test.ts` fails if any file there still has a comment or one of those names, or if the Storybook config, scripts or browser tests have a comment. The shadcn components generated on 2026-11-01 had no comments at all, but later registry versions may. Source: DS-000.

## Kit tokens and shadcn's names share one theme

`packages/tokens/src/tokens.css` holds the kit's colour tokens under their kit names (`--page`, `--chrome`, `--accent` and the rest) on `:root` and `[data-theme="dark"]`, and the light values on `[data-theme="light"]`. Dark is the default. `theme.css` removes Tailwind's default palette with `--color-*: initial` and then maps both the kit names and shadcn's names (`background`, `primary`, `muted`, `border` and the rest) to the kit variables in `@theme inline`, so `bg-chrome-2` and `bg-muted` read the same token. It also defines shadcn's raw variables such as `--secondary` and `--radius` on `:root, [data-theme]`, because a few generated classes read them inside arbitrary values. They are set on `[data-theme]` as well so a nested theme scope recomputes them. shadcn's own raw `--accent` is never defined, because the kit's `--accent` owns that name. The `dark:` variant matches anything not inside `[data-theme="light"]`. Radii map `sm` to 4 px, `md` and `lg` to 7 px and `xl` and above to 10 px, and `--spacing` is the 4 px `--space` token. Source: DS-000.

## Biome needs Tailwind directives switched on

Biome cannot parse `@theme`, `@custom-variant`, `@source` or `@apply` until `css.parser.tailwindDirectives` is `true` in `biome.json`. Four Biome rules are off only for `packages/ui/src/components/**`, because shadcn uses those patterns on purpose: `noArrayIndexKey` (slider thumbs are positional), `useSemanticElements` (a `div` with `role="group"` in the input group), `useKeyWithClickEvents` (a click on the input group's addon focuses its input) and `noLabelWithoutControl` (the generic `Label` wrapper has no control of its own, added by PROTO-011). Biome's `useHookAtTopLevel` treats any function named `use…` as a hook, so a plain helper must not start with `use`. `noLabelWithoutControl` lists `Switch` as an input component, so a `<label>` that wraps a switch, which is how Base UI labels it, passes. Source: DS-000.

## The axe suite runs over the built Storybook

`pnpm --filter @parfocal/ui test:browser` builds the static Storybook and runs `e2e/axe.spec.ts` with Playwright on Chrome. It opens every story in `storybook-static/index.json` in dark and in light and runs `@axe-core/playwright` with the WCAG 2.0, 2.1 and 2.2 A and AA tags. Turborepo's `test:browser` task picks it up, so the CI `browser` job runs it. Three things matter. First, the story URL sets `globals=theme:<theme>;a11y.manual:!true`, because Storybook's a11y addon otherwise starts its own axe run in the same frame and the second one fails with "Axe is already running". Second, the wait for open animations uses `Promise.allSettled`, because a cancelled animation rejects its `finished` promise with `AbortError`. Third, the suite excludes `[data-base-ui-focus-guard]`. Base UI puts these visually hidden `span`s with `tabindex="0"` and `aria-hidden="true"` around open popups so it can move focus back into them, and axe reports them as `aria-hidden-focus`. Source: [axe result](../results/2026-11-01-axe-over-the-component-stories.md).

## Base UI controls that need a name

A Base UI slider labels its thumb inputs, not its root, so `aria-label` on `Slider` leaves the thumbs nameless. The shadcn `Slider` here passes `getAriaLabel` through to every thumb. The combobox's chevron button had no name, and Base UI hides the input group's addon with `aria-hidden` while the list is open, which made the focusable button an `aria-hidden-focus` violation. `ComboboxInput` now names it with `triggerLabel`, which defaults to "Show options", and takes it out of the tab order as the ARIA combobox pattern does. Source: [axe result](../results/2026-11-01-axe-over-the-component-stories.md).

## Storybook runs React Compiler

`packages/ui/vite.config.ts` uses `@vitejs/plugin-react` with `@rolldown/plugin-babel` and `reactCompilerPreset()`, as [ADR 0016](../adr/0016-react-19-spa-compiler-strictmode.md) (React 19 SPA with React Compiler) sets for the app, and Storybook picks that config up. plugin-react 6.1.2 accepts `@rolldown/plugin-babel` only up to 0.2.x, so it is pinned at 0.2.4 although 0.3.0 is out. `typescript.reactDocgen` is off because the catalogue has no docs pages, and its `react-docgen-typescript` option would need the TypeScript compiler API, which TypeScript 7 does not ship. Source: DS-000.

## Orval's MSW sidecar needs its import extensions added

`packages/api-client/orval.config.ts` turns on Orval's MSW generator, which writes `src/generated/api.msw.ts` next to `api.ts` in `single` mode. The sidecar imports `./api` without an extension even though the config sets `allowImportingTsExtensions`, which does not resolve under `nodenext`. Orval 8.46.0 does the same, and `split` mode leaves the schema imports bare too. `pnpm --filter @parfocal/api-client generate` therefore runs `scripts/add-import-extensions.ts` on the sidecar before Biome, and `test/generate.test.ts` fails if the committed file lacks the extension. Use the MSW generator alone, because `mock: true` also writes `api.faker.ts`, whose factories duplicate the ones in the MSW file. Source: [ADR 0135](../adr/0135-fake-data-through-the-api-client-with-msw.md) (fake data through the API client).

## MSW 3 keeps the root imports Orval generates

The MSW 2 to 3 migration guide moves `http`, `HttpResponse` and `delay` to `msw/http` and `msw/utils/*`, but the 3.0.3 root entry still exports them, so Orval's `from "msw"` imports work. What did change is `worker.start({ onUnhandledFrame })` and `server.listen({ onUnhandledFrame })`, which replace `onUnhandledRequest`. In Node tests the generated client's relative URLs need a base, so `packages/api-client/test/fake.test.ts` wraps the patched `fetch` with `new URL(input, "http://app.test")` after `server.listen()`. Source: PROTO-000 (research check for the fake data layer).

## The MSW worker is served only by the dev server

`apps/web/vite.config.ts` uses `msw({ mode: "worker-only" })` from `msw/vite` to serve `/mockServiceWorker.js`, with `apply: "serve"`. Without `apply: "serve"`, worker-only mode emits the worker into every build, the production one included. The fake layer is imported only inside `if (import.meta.env.DEV && config.fakeApi !== "off")`, so a production build drops it. Note that `vite build --mode development` still sets `DEV` to false unless `NODE_ENV=development` is set too. The flag is `PARFOCAL_PUBLIC_FAKE_API`, because the public env plugin fails the build for any other prefix, and config refuses anything but `off` in staging and production. `apps/web/test/bundle.test.ts` builds staging and production with the flag set and checks the output for `mockServiceWorker`, `[MSW]` and a generated handler path. Source: PROTO-000 (research check for the fake data layer).

## Draft hooks stand in for operations the API does not have yet

A screen that needs an operation the backend has not shipped imports a draft hook from `@parfocal/api-client`, written in `packages/api-client/src/draft/` with the names Orval will generate for the planned operationId, such as `listMyJobs`, `getListMyJobsUrl`, `getListMyJobsQueryKey`, `getListMyJobsQueryOptions` and `useListMyJobs`. The response type comes from a Zod schema that also parses the fake body, and the query carries `meta: { draft: "<operationId>" }`, which the fake data badge reads. Its MSW handler, `get<Op>MockHandler`, goes in `src/fake/draft-handlers.ts` together with an entry in `draftOperations` that names the planned method and path. `test/draft.test.ts` fails when a draft name is also generated, when a planned path or operationId appears in `openapi.json`, or when a draft lacks one of the names, and `export *` of a clashing name also fails the typecheck with TS2308. When the route ships, regenerate the client and delete the draft and its handler. Source: [ADR 0135](../adr/0135-fake-data-through-the-api-client-with-msw.md) (fake data through the API client).

## The scenario seed and the fake API modes

`packages/api-client/src/fake/scenario.ts` holds the one story every fake screen tells, taken from the round 6 POC mock: the people with Lenka Malá signed in, the workspace Fakultní nemocnice Vltava, projects P07, P03, P09 and P11, cases, slides, result sets, review tasks RT-14, RT-15 and RT-11, jobs and object IDs such as `P07/S26-04812/A1/T2·C145`. It holds no patient identity. `scenario-handlers.ts` turns it into generated response types and puts those handlers ahead of `getParfocalAPIMock()`, so every other operation still answers with typed faker data from seed 4812. `PARFOCAL_PUBLIC_FAKE_API=all` (`pnpm --filter @parfocal/web dev:fake`) answers every call, and `drafts` answers only the draft operations while the rest go to the local API through the dev proxy. Generated handlers name path parameters in camel case, such as `:projectId`, although the OpenAPI path says `{project_id}`. Source: PROTO-002 (fake data layer for the app and the catalogue).

## One React and one Query client for the app and the API client

The generated hooks import `@tanstack/react-query` from `packages/api-client`, so the API client's own React must be the same version as the app's, or pnpm installs a second `@tanstack/react-query` bound to the other React and the app's `QueryClientProvider` is not the one the hooks look for. The API client now pins React 19.3.1 like `apps/web` and `packages/ui`, and `apps/web/vite.config.ts` also dedupes `react`, `react-dom` and `@tanstack/react-query`. The app and Storybook start the MSW worker through `@parfocal/api-client/fake/browser`, so the handlers and the worker come from one copy of MSW although pnpm installs two peer variants of it. Source: PROTO-002 (fake data layer for the app and the catalogue).

## TanStack Router in the app

`apps/web` uses file-based routes in `src/routes` with the router plugin set to `autoCodeSplitting`, `addExtensions`, double quotes and semicolons, as [ADR 0048](../adr/0048-routing.md) (routing) records. The plugin rewrites `src/routeTree.gen.ts` on every dev or build run, and the file is committed so the typecheck can see it. It is excluded from Biome and oxlint because it holds `as any` casts. `test/routes.test.ts` typechecks `test-types/wrong-links.tsx` through `tsconfig.wrong-links.json` and fails unless a misspelled path, a missing param, a wrong search type, an unknown search key and a wrong search value each give an error, which guards against a route tree that silently types as `any`. The router writes search defaults into the URL, so `/projects/<id>` becomes `/projects/<id>?tab=slides`. `throw redirect()` and `throw notFound()` are allowed by an exception to oxlint's `only-throw-error` for `@tanstack/router-core`. React Compiler skips `generated/` and `node_modules`, because Babel otherwise deoptimises the 0.8 MB `api.ts` on every build. Source: PROTO-002 (fake data layer for the app and the catalogue).

## The app's Tailwind must scan packages/ui

Tailwind v4 finds class names by scanning files from the Vite root, and it skips `node_modules`, where `@parfocal/ui` sits as a workspace link. Before PROTO-012 (How a review works, the flow map) the app only got a component's classes when some file in `apps/web/src` happened to use the same class, so a new component such as `LaneMap` rendered without `absolute` or `fill-none` while Storybook, which runs from `packages/ui`, looked right. `packages/ui/src/styles/globals.css` now has `@source "../components";` next to the `apps/web/src` source. If a component looks unstyled in the app but fine in Storybook, check the `@source` lines first. Source: PROTO-012.

## Placeholder routes, scenes and the bar above the frame

Every mock screen that a PROTO task has not built yet still has its planned route, which renders `Placeholder` with the task that builds it. PROTO-012 (How a review works, the flow map) added them so every box of the flow map opens a real route. A screen's scene is the search key `scene`, typed by `z.enum(mockScenes.<screen>)` from `apps/web/src/screens/scenes.ts`, and `test/flow-map.test.ts` fails when a list there drifts from the PROTO-001 inventory. The map's links are typed, so renaming a route breaks the typecheck of `src/flow-map/targets.ts` instead of leaving a dead box. A box draws dim until its screen id is in `builtScreens` in `src/flow-map/review-flow.ts`, so each PROTO screen task adds its screen ids there when it lands. The dev-only bar with Back to the map and the walkthrough steps is the router's `InnerWrap`, so it sits above the shell without touching `__root.tsx`, and it remembers where it came from in session storage. Vite can load a second React for a moment when it first optimises a new dependency such as `@base-ui/react/use-render`, which shows as an invalid hook call. Reload once and it is gone. Source: PROTO-012.

## MSW in Storybook

`packages/ui/.storybook/preview.tsx` uses `mswLoader` from `msw-storybook-addon/csf3` with a setup function that starts the shared worker over `fakeApiHandlers("all")`. The addon's default setup passes MSW 2's `onUnhandledRequest`, which MSW 3 renamed, so the custom setup is required. A story overrides the scenario with `parameters: { msw: [handler] }`. `msw({ mode: "worker-only" })` in `packages/ui/vite.config.ts` serves the worker and emits it into `storybook-static`, which is right there because that config builds only the catalogue. `e2e/fake-api.spec.ts` checks the built catalogue reads the scenario and that a story's own handler wins. Source: PROTO-002 (fake data layer for the app and the catalogue).

## The kit's text sizes need the configured cn

The kit's nine type sizes are Tailwind theme sizes named `text-label`, `text-caption`, `text-body-sm`, `text-body`, `text-lead`, `text-title-sm`, `text-title`, `text-page-title` and `text-display`. The `cn` package that shadcn imports merges like tailwind-merge and takes an unknown `text-*` class for a text colour, so `cn("text-on-accent", "text-body-sm")` dropped the colour and every primary button showed grey text. `packages/ui/src/lib/utils.ts` builds `cn` with `createCn` from `cn/config` and adds the nine sizes, the `rounded-ctl` and `rounded-zone` radii and `shadow-pop`. Import `cn` from `@parfocal/ui/lib/utils`, never from `cn`. The adopt script rewrites `import { cn } from "cn"` in every adopted file, so a new shadcn component is fixed by `shadcn:adopt`, and `test/adopt.test.ts` fails on a bare import and checks that a colour survives next to a kit size. Source: PROTO-011 (every kit component in rough form).

## Tokens: what sits where

`tokens.css` has three blocks. The dark block (`:root, [data-theme="dark"]`) and the light block (`[data-theme="light"]`) hold exactly `themedTokens` from `src/index.ts`, which is every colour plus `shadow`, and `tokens.test.ts` fails if a theme block gains or loses one. The aliases `page`, `chrome` and `chrome-2` are written out in both blocks instead of `var(--surf-page)` on `:root`, because a custom property that refers to another one is resolved where it is declared, so a nested `data-theme` scope would keep the outer theme's value. Class colours, the proposal colour and every size live once in the plain `:root` block, because they do not change with the theme. The kit's research status tone uses `--res` (`#a78bfa` dark) for its tint and `research-fg` (`#c4b5fd`) for its text, so both exist. Source: PROTO-011.

## Never type a bare bg-accent

The adopt script renames the exact class `bg-accent` to `bg-chrome-2` (shadcn's hover surface), also in hand-written files, and `adopt.test.ts` then fails because the file changes. For a fill in the kit's accent write `bg-(--accent)`, and use `bg-accent-fill` or `bg-accent-soft` where those are meant. Source: PROTO-011.

## Icons come from the frozen mock

`packages/ui/scripts/generate-icons.ts` reads the 76 `<symbol id="i-…">` elements of `docs/design/ux-mock/index.html` and writes `src/components/icon-set.tsx`, then Biome formats it. `Icon` takes `name`, `size` (`xs` 12, `sm` 16, `md` 20, `lg` 24, `xl` 40) and an optional `label`. With a label it is `role="img"` with that name, without one it is `aria-hidden`. Each size also sets a `size-*` class, because shadcn components size every child `svg` that has no `size-` class to 16 px. Source: PROTO-011.

## Writing stories for the catalogue

Component stories sit on a panel surface through a `decorators` entry, because in light the story page is `#ececec` and accent, warn and bad tags only reach 4.5:1 on a panel. Kit page stories under `Kit/Pages` use `layout: "fullscreen"` and show both themes side by side with nested `data-theme` blocks, which works because the tokens are declared again on every `[data-theme]`. The `dark:` variant does not flip inside such a block, so do not rely on it in a specimen. The mock's slide images are served to Storybook at `/mock-assets/` through `staticDirs` in `.storybook/main.ts`. The repo uses `exactOptionalPropertyTypes`, so an optional prop that callers may pass as `undefined` is typed `prop?: T | undefined`. Source: PROTO-011.

## The axe suite also catches render errors

`e2e/axe.spec.ts` records page errors and console errors for every story in both themes and fails on any, next to the axe check, and it fails when Storybook shows its error display. The browser's request for `/favicon.ico` answers 404 and logs a console error, so that one location is ignored. `knownExclusions` lists a selector per story id that axe skips, each with the DS task that fixes it, and the [axe result](../results/2026-11-01-axe-over-the-component-stories.md) records why. Source: PROTO-011.

## The global shell wraps a list of route ids

The root route renders `GlobalShell` around every route whose id is in `apps/web/src/shell/shell-routes.ts`, so a screen task that wants the top bar and sidebar adds its route id there instead of moving files under a layout route. Slide routes, guided review, setup and admin stay outside. The root also owns two search params for overlays, `open` (`notifications` or `palette`) and `find` (the palette's query), and hosts the command palette, so ⌘K works on every route. Links to routes that other screen tasks own go through the href builders in `apps/web/src/shell/destinations.ts` and `router.navigate({ href })`, so a screen does not fail the typecheck while another task's route file is not committed yet. Source: PROTO-003 (home, My work and the shell over fake data).

## The fake view switches the person the scenario answers for

Some mock scenes are a different person, not a different screen state: My work's Assigned by me is Daniel Hruška, `scene=anna` is Anna Kopecká and home's `scene=new` is Lenka's first week. `setFakeView({ viewer, firstWeek })` from `@parfocal/api-client/fake` changes what every seeded handler answers, because the handlers read `fakeView()` at request time instead of building their bodies once. `apps/web/src/fake-api/view-rules.ts` maps a path and its search onto a view, the fake layer applies it on start and on every navigation, and resets the queries when it changed, so `getMe` and the lists refetch for the new person. The fake data badge names the persona. Unit tests that change the view reset it with `setFakeView(defaultFakeView)` after each test, because the store is module state. Source: PROTO-003 (home, My work and the shell over fake data).

## Fake mode fixes the clock and serves the mock's images

In `PARFOCAL_PUBLIC_FAKE_API=all` the fake layer calls `fixClock` with the scenario's `scenarioNow` (Thursday 15 October 2026, 14:30), so greetings, "10 min ago" and due dates read as in the mock. Screens take the time from `now()` in `apps/web/src/clock.ts`, never from `new Date()` directly. The dev server serves `docs/design/ux-mock/assets` at `/mock-assets` through a plugin with `apply: "serve"`, which slide thumbnails use until the viewer tasks bring real ones, and builds do not contain it. Source: PROTO-003 (home, My work and the shell over fake data).

## The slider sizes by its orientation attribute

Base UI 1.9 marks the slider root, control and track with `data-orientation="horizontal"`, but the shadcn slider was generated with Tailwind's `data-horizontal:` variants, which match a bare `data-horizontal` attribute. The track had no height and the root no width, so every slider was invisible. `packages/ui/src/components/slider.tsx` now uses `data-[orientation=horizontal]:` and `data-[orientation=vertical]:`. The root's `data-[orientation=horizontal]:w-full` outranks a plain width class such as `w-60`, because an attribute selector adds specificity, so give a slider its width through the cell it sits in, for example a `grid-cols-[240px_auto]` row. Source: PROTO-006 (New review task over fake data).

## A label may wrap a checkbox or a radio

Biome's `noLabelWithoutControl` lists `Switch`, `Checkbox` and `RadioGroupItem` as input components in `biome.json`, so a `<label>` that wraps one of the Base UI controls with its text passes without a suppression comment. Source: PROTO-006 (New review task over fake data).

## Playwright waits on an aria-disabled button

The flow pages keep Next clickable while it is `aria-disabled="true"`, as the mock does, so a press marks the step's fields and moves focus to the first one. Playwright counts `aria-disabled` as disabled and waits for it to clear, so a test that presses a blocked Next asserts the attribute first and then clicks with `force: true`. Source: PROTO-006 (New review task over fake data).
