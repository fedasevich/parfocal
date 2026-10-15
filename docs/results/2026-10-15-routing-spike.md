# Result: routing spike

- Date: 2026-10-15
- Backlog: STACK-003 (routing)
- Kind: spike
- Commit: 4f1be06 (the spike code lived in a directory outside the repository and was not committed)
- Environment: MacBook, macOS Darwin 24.6.0, Node 26.9.0, npm registry as of 2026-10-15. No browser was used, so there are no runtime, navigation or render timings.
- Data: synthetic route parameters (`c1`, `s1`) and synthetic query strings. No PHI.

## Question

Can TanStack Router and React Router in library mode both express `/case/:caseId/slide/:slideId?x=&y=&z=` with validated, typed search params and a code-split route, under TypeScript 7 with the repository's strict flags and React Compiler? What does each cost in bundle size, and what does each catch at typecheck time? There is no POC number and no routing bundle budget (TODO: no budget exists for the app shell).

## Method

All work ran in `/Users/yuriifedas/.claude/jobs/95034c12/tmp/stack-003`. Nothing was installed in the repository. Each candidate is its own npm project, plus a `baseline` project that holds only React DOM and the same Zod schema.

1. Versions matched the repository lockfile where the lockfile has them: react and react-dom 19.3.0, zod 4.6.5, vite 8.3.3, typescript 7.0.2. Other exact versions are in the table below.
2. The tsconfig copies the repository flags from `packages/typescript-config/base.json` and `browser.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`, `module` and `moduleResolution` `nodenext`, `lib` es2024 with dom) and adds `jsx: react-jsx`.
3. React Compiler 1.0.0 was on through `@rolldown/plugin-babel` with `reactCompilerPreset()` from `@vitejs/plugin-react` 6.1.2, as ADR 0016 chose.
4. The search schema in Zod 4 has `x` and `y` as numbers from 0 to 1 with default 0.5, and `z` as an integer from 0 to 20 with default 0.
5. TanStack Router: file-based routes (`__root`, `index`, `case.$caseId.slide.$slideId`), `validateSearch: slideSearchSchema` with the Zod schema passed directly, `autoCodeSplitting: true` in `@tanstack/router-plugin`, and the `Register` interface for the router.
6. React Router: `createBrowserRouter` with the slide route loaded through `lazy: () => import("./slide-route.tsx")`. Because library mode has no search param validation, the spike wrote `parseSlideSearch` (Zod `safeParse` over `Object.fromEntries(searchParams)`, with `z.coerce.number()` because query values are strings) and `slideHref`, a typed URL builder over the router's `href()`. Path param types come from a hand-written `Register` declaration with `pages`. The same source was built against react-router 7.18.4 and 8.4.0.
7. Typecheck: `tsc --noEmit -p .` with TypeScript 7.0.2 on the clean source, then again with a `wrong.tsx` file that passes a string for `x`, omits `slideId` and passes an unknown key `w`. For React Router a second file, `untyped.tsx`, uses plain string links.
8. Runtime validation: TanStack through a Vite `ssrLoadModule` script that creates a memory-history router from the generated route tree and calls `router.load()`. React Router by calling `parseSlideSearch` directly under Node.
9. Bundles: `vite build` for each project, then raw bytes and `gzip -9` bytes per file from `sizes.mjs` (Node `zlib`, level 9).
10. React Compiler output was confirmed by reading the built route chunk for the memo cache calls. A first React Router build was not compiled, and the cause was found with `babel-plugin-react-compiler` and a logger.

## Results

Versions.

| Package | Version |
|---|---|
| @tanstack/react-router | 1.170.44 |
| @tanstack/router-plugin | 1.168.46 |
| react-router (library mode) | 7.18.4 and 8.4.0 |
| react, react-dom | 19.3.0 |
| zod | 4.6.5 |
| vite | 8.3.3 |
| typescript | 7.0.2 |
| @vitejs/plugin-react | 6.1.2 |
| @rolldown/plugin-babel | 0.2.4 |
| babel-plugin-react-compiler | 1.0.0 |
| @babel/core | 8.0.7 |

Typecheck on the clean source, TypeScript 7.0.2, exit code 0 for all three. Wall time of `npx tsc --noEmit` on a project of 4 to 6 files, one run each.

| Candidate | Exit code | Wall time |
|---|---|---|
| TanStack Router 1.170.44 | 0 | 0.385 s |
| React Router 7.18.4 | 0 | 0.371 s |
| React Router 8.4.0 | 0 | 0.380 s |

Typecheck on the deliberately wrong code.

| Candidate | Case | Result |
|---|---|---|
| TanStack | `search={{ x: "left", ... }}` on `<Link>` | error TS2322, string not assignable to number |
| TanStack | `params={{ caseId: "c1" }}` without `slideId` | error, property `slideId` is missing |
| TanStack | `search={{ w: 1 }}` | error TS2353, `w` does not exist |
| TanStack | `<Link>` with no `search` (Zod defaults make every key optional) | no error |
| React Router 7 and 8 | wrong type through `slideHref(..., { x: "left" })` | error TS2322 |
| React Router 7 and 8 | `slideHref({ caseId: "c1" }, ...)` | error TS2741, `slideId` missing |
| React Router 7 and 8 | `href("/case/:caseId/slide/:slideId", { caseId: "c1" })` | error TS2741, `slideId` missing |
| React Router 7 and 8 | `slideHref(..., { w: 1 })` | error TS2353 |
| React Router 7 and 8 | `<Link to="/case/c1/slide/s1?x=left">` | no error |
| React Router 7 and 8 | `<Link to="/case/c1/slid/s1">` (misspelled path) | no error |

Error counts in the wrong file: TanStack 3, React Router 4 (7.18.4 and 8.4.0 identical).

A first TanStack typecheck also passed on the wrong file with zero errors. The generated `routeTree.gen.ts` imported `./routes/__root` without an extension, which does not resolve under `moduleResolution: nodenext`. The file is `@ts-nocheck`, so the failed import was silent and the route types were effectively `any`. Setting `addExtensions: true` on the router plugin fixed it, and the three errors above appeared.

Runtime validation, TanStack Router, memory history, route loaded through the generated tree.

| URL query | Outcome |
|---|---|
| `x=0.25&y=0.75&z=3` | route matched, search `{x: 0.25, y: 0.75, z: 3}`, params `{caseId: c1, slideId: s1}` |
| `x=abc` | route status `error`, Zod issue `expected number, received string` at `x` |
| `z=1.5` | route status `error`, Zod issue `expected int` at `z` |
| `z=99` | route status `error`, Zod issue `too_big`, maximum 20 |
| `x=2` | route status `error`, Zod issue `too_big`, maximum 1 |
| no query | no matches after `router.load()` in this harness (see Interpretation) |

Runtime validation, React Router, `parseSlideSearch` under Node.

| URL query | Outcome |
|---|---|
| `x=0.25&y=0.75&z=3` | success, `{x: 0.25, y: 0.75, z: 3}` |
| no query | success, defaults `{x: 0.5, y: 0.5, z: 0}` |
| `x=abc` | failure, `x: Invalid input: expected number, received NaN` |
| `z=1.5` | failure, `z: Invalid input: expected int, received number` |
| `z=99` | failure, `z: Too big: expected number to be <=20` |
| `x=2` | failure, `x: Too big: expected number to be <=1` |
| `x=` (empty value) | success, `x` becomes 0, because `Number("")` is 0 |
| `x=0.5&x=0.7` | success, `x` is 0.7, because `Object.fromEntries` keeps the last value |

Bundles from `vite build`, minified, target es2024, React Compiler on, Zod and React DOM in the main chunk. The baseline holds React DOM, the Zod schema and no router.

| Project | File | Raw bytes | Gzip bytes |
|---|---|---|---|
| baseline | index | 286,166 | 86,832 |
| TanStack | index (main) | 363,923 | 114,048 |
| TanStack | case.$caseId.slide.$slideId (lazy route chunk) | 668 | 447 |
| TanStack | compiler-runtime (shared chunk) | 226 | 203 |
| TanStack | routes (index route chunk) | 368 | 292 |
| React Router 7.18.4 | index (main) | 380,816 | 117,385 |
| React Router 7.18.4 | slide-route (lazy route chunk) | 843 | 550 |
| React Router 8.4.0 | index (main) | 380,950 | 117,226 |
| React Router 8.4.0 | slide-route (lazy route chunk) | 843 | 550 |

Main chunk minus baseline, which approximates the router's cost.

| Candidate | Raw bytes | Gzip bytes |
|---|---|---|
| TanStack Router 1.170.44 | 77,757 | 27,216 |
| React Router 7.18.4 | 94,650 | 30,553 |
| React Router 8.4.0 | 94,784 | 30,394 |

Code splitting. Both builds emit the slide route as its own chunk. In the TanStack build, the Zod schema stays in the main chunk because `validateSearch` is not split by `autoCodeSplitting`. In the React Router build, Zod is in the main chunk because the home route imports `slideHref`.

React Compiler. The TanStack route component compiled on the first build. The React Router route did not, and its chunk had no memo cache calls. `babel-plugin-react-compiler` 1.0.0 reported `CompileError (BuildHIR::lowerAssignment) Expected object property value to be an LVal, got: AssignmentPattern` for `const { caseId = "", slideId = "" } = useParams()`. After rewriting the line as two statements that read `params.caseId ?? ""` and `params.slideId ?? ""` from the `useParams()` result, the logger reported no error, and the route chunk grew from 421 to 843 bytes with the memo cache. The 843-byte numbers above are from the compiled build.

## Interpretation

- Both candidates meet the task's stated bar for a spike: a route at `/case/:caseId/slide/:slideId` with validated search params and a separate lazy chunk. TanStack gives the typing from the router itself. React Router gives it only through code the project writes, which is the `Register` pages declaration, `slideHref` and `parseSlideSearch` here.
- Typed links are the main difference. TanStack rejected all three wrong calls on its own `<Link>` and `navigate`. React Router rejected wrong calls only through the project's own builder. A raw string link with a wrong type or a misspelled path typechecked, so a developer can bypass the checks by not using the helper. Whether a lint rule could close that gap was not tested (TODO).
- The size difference is 3.3 KB gzip against React Router 7.18.4 in TanStack's favour. This is an approximation. The baseline and the apps differ in more than the router (the route table, the home link, the helper code), and one build each was measured, so differences of a few hundred bytes are noise (assumption). The result does not support a claim that either router is smaller in a larger app.
- The 3.3 KB gap is small next to the viewer's expected dependencies (see ADR 0045 for the same comparison on forms). It is not a deciding factor.
- Neither router moves Zod out of the main chunk, so validation code is not lazy in either design (assumption: validation must run before the route renders).
- The `addExtensions` finding is a real hazard. A route tree that fails to resolve gives no error and turns off all route typing. The wrong-code file is the check that exposed it, so the project should keep a deliberate-wrong typecheck test.
- The React Compiler finding is not specific to either router. The `AssignmentPattern` bail-out is about destructuring with defaults in the component body. It was found on React Router code only because the TanStack spike code did not use that pattern. Any route component that destructures with defaults would hit it with both routers (assumption, not tested on TanStack).
- In the TanStack runtime harness, the bare URL `/case/c1/slide/s1` produced no matches after `router.load()`. The harness runs under `ssrLoadModule`, so the router is in server mode. The likely cause is a redirect to a canonical URL that has no history listener in Node (assumption). It was not confirmed. The two-line check is TODO below.
- Query string behaviour differs. TanStack parses values as JSON by default, so `x=0.25` arrives as the number 0.25 and `x=abc` as a string that fails `z.number()`. The React Router helper receives strings and needs `z.coerce`, which turns an empty `x=` into 0.

## Follow-ups

- ADR written: [ADR 0048](../adr/0048-routing.md).
- TODO: run the route in a real browser and confirm the bare URL behaviour, the error component on a bad search param, back and forward behaviour and the chunk request on first navigation.
- TODO: decide whether `routeTree.gen.ts` is committed or generated before typecheck in CI. `vite build` wrote it in the spike, and nothing here tested `@tanstack/router-cli`.
- TODO: measure render counts for a component that reads one search key while another changes, because the viewer URL will change often. TanStack's `select` option is the candidate and it was not tested.
- TODO: test `search` middleware for retaining `x`, `y` and `z` across navigation, and the effect of `.catch()` against an error route on invalid values.
- TODO: add the React Compiler default-destructuring bail-out to `docs/knowledge/` when the owner consolidates.
