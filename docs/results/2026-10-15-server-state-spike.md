# Result: server state and data fetching spike

- Date: 2026-10-15
- Backlog: STACK-004 (server state and data fetching)
- Kind: spike
- Commit: 4f1be06 (the spike code lived in `/Users/yuriifedas/.claude/jobs/95034c12/tmp/stack-004`, outside the repository, and was not committed)
- Environment: MacBook, macOS Darwin 24.6.0, Node 26.9.0, npm registry as of 2026-10-15. Tests ran in Vitest with jsdom, so there is no real browser and no render or paint timing. The network was a stubbed `fetch`. No real WebSocket or Durable Object was used.
- Data: synthetic cases and annotations with invented labels. No PHI.

## Question

Does TanStack Query v5 work with the generated Orval client ([ADR 0017](../adr/0017-orval-api-client.md)) under TypeScript 7 and the repository's strict flags, for four jobs? The jobs are query keys from the generated client, invalidation driven by a realtime event ([STACK-024 (realtime transport)](../BACKLOG.md)), an optimistic annotation edit with rollback and retry, and suspense queries. What does each candidate cost in bundle size? There is no bundle budget for server state yet and no POC number to compare against (TODO: no budget is set in the backlog).

## Method

All work ran in a directory outside the repository. Nothing was installed in the repository.

1. Installed exact versions: react and react-dom 19.3.0, @types/react 19.3.0, @tanstack/react-query 5.104.1, typescript 7.0.2, vitest 5.0.4, jsdom 30.1.2, @testing-library/react 16.3.3, orval 8.40.0, swr 2.5.1, @reduxjs/toolkit 2.13.0, react-redux 9.3.0, rolldown 1.2.14. The react-query, react and orval versions match `packages/api-client/package.json`.
2. Copied the generated client (`packages/api-client/src/generated/api.ts`), `fetcher.ts`, `problem.ts` and `openapi.json` from commit 4f1be06. Copied the strict flags from `packages/typescript-config/base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`, `moduleResolution: nodenext`) and added `jsx: react-jsx`.
3. Ran Orval 8.40.0 a second time with `override.query.useSuspenseQuery: true` into a separate file, and again after adding `export type ErrorType<Error> = ApiError;` to the spike copy of the fetcher. The committed client was not touched.
4. Wrote the spike modules: a query client factory, a retry policy, a fake realtime source with an invalidation hook, an annotation list query with an optimistic edit mutation, and an `unwrap` helper for the response envelope.
5. Stubbed `globalThis.fetch` with an in-memory fake API (cases, annotation lists, scripted failures, gates that hold a request open) so that the real `apiFetch` and `ApiError` code ran.
6. Wrote 16 Vitest tests in three files. Ran `tsc -p .` with TypeScript 7.0.2 and `vitest run`.
7. Bundle sizes: minified with rolldown 1.2.14 (the bundler behind Vite 8), esm format, react and react-dom external, gzip is `gzip -9`. Each library was measured through an entry that re-exports the hooks and providers a data layer would use.

## Results

Typecheck: `tsc -p .` with TypeScript 7.0.2 and the repository flags exited 0 over the spike modules, the 16 tests and both generated files. Earlier runs in the same setup reported errors, which shows that tsc was checking.

Tests: 3 files, 16 of 16 passed in 2.78 s.

| Test | Result |
|---|---|
| Generated keys are `["/api/cases/c1"]`, `["/api/cases"]` and `["/api/cases", {state}]` | passed |
| Invalidating `["/api/cases"]` refetched the list (1 to 2 fetches) and did not refetch `/api/cases/c1` (stayed at 1) | passed |
| The cache holds the whole envelope with `status`, `data` and a `Headers` object | passed |
| `case.updated` for c1 refetched c1 (2 fetches) and not c2 (1 fetch) | passed |
| `case.updated` for an unmounted query marked it stale and did not fetch | passed |
| A `reconnected` status refetched both active queries (2 fetches each) | passed |
| The subscription was removed on unmount | passed |
| Optimistic edit visible before the PUT resolved, then one refetch, server version 2 | passed |
| 422 on the PUT: 1 PUT, cache rolled back | passed |
| Two network failures then success: 3 PUTs, the cache held the edited label at all 3 PUTs | passed |
| Persistent 500: 4 PUTs (1 plus 3 retries), cache rolled back | passed |
| First edit fails with 422 while a second edit is in flight: the second edit stayed visible, then the refetch gave the server truth | passed |
| `annotation.changed` during a local edit caused no refetch, the next one after settling did (GET count 1, 2, 3) | passed |
| Suspense: fallback then data | passed |
| Suspense with a prefetched query: no fallback, 1 fetch | passed |
| Suspense with a 404: the error boundary received an `ApiError` of kind `not-found`, and reset after the case existed rendered it | passed |

Suspense waterfall, measured as the time between the starts of the first and second GET with a 60 ms fake server delay.

| Pattern | Second fetch start minus first fetch start |
|---|---|
| Two `useGetCaseSuspense` calls in one component | 60.6 ms |
| One `useSuspenseQueries` with two queries | 0.03 ms |

Type findings, each seen as a `tsc` error before the workaround.

| Finding | Detail |
|---|---|
| The response type is a union | Each generated hook returns `CaseDetail \| Problem` inside `data`, because Orval types every documented status. The fetcher throws on non-2xx, so only the 200 member is real. `select: unwrap` with a status check narrows it |
| The error type is wrong by default | Hooks type the error as `Problem`, but the fetcher throws `ApiError`. Exporting `ErrorType<E> = ApiError` from the mutator made Orval emit `ErrorType<Problem>`, which resolved to `ApiError` |
| Generated options objects fail under `exactOptionalPropertyTypes` | Passing `getGetCaseQueryOptions(id)` to `useSuspenseQuery` or `ensureQueryData` failed because `queryFn` may be `undefined` or `skipToken`. The generated hooks themselves typecheck |
| `useSuspenseQueries` needs the registered error type | With the generated options and no `Register` augmentation, `retry` was typed for `Error` and failed. Declaring `Register { defaultError: ApiError }` fixed it |
| Suspense hooks are generated on request | With `useSuspenseQuery: true` Orval emitted a `Suspense` hook and options builder for each of the 19 GET operations. They reuse the plain query key, so the Suspense and plain hooks share one cache entry |

Bundle size, minified with rolldown, react external.

| Entry | Minified | Gzip |
|---|---|---|
| @tanstack/react-query 5.104.1 (client, provider, `useQuery`, `useMutation`, `useSuspenseQuery`, `useSuspenseQueries`, error reset boundary) | 38,850 B | 11,203 B |
| swr 2.5.1 (`useSWR`, `useSWRMutation`, `SWRConfig`, `mutate`) | 14,698 B | 6,466 B |
| @reduxjs/toolkit 2.13.0 `configureStore`, `createApi` and `fetchBaseQuery` from `query/react`, and react-redux 9.3.0 `Provider` | 75,898 B | 25,392 B |
| Spike entry: three generated hooks (`useGetCase`, `useListCases`, `useUpdateFolder`), the annotation hooks, query client factory and realtime hook, with TanStack Query | 40,138 B | 11,923 B |

The SWR and RTK Query entries were measured only for size. No SWR or RTK Query code was run in this spike.

## Interpretation

- The generated URL keys are flat strings. A prefix such as `["/api/cases"]` does not reach `["/api/cases/c1"]`, because the first element differs. This is a fact from the test. Invalidation has to name exact keys through the generated key builders, or use a predicate.
- The retry test shows that the optimistic value survives retries and is rolled back only after the policy gives up. The retry delay was 1 ms in the tests, so the production delays (250 ms doubling to a 4 s cap, 3 retries) were not exercised end to end. TODO: they are a starting assumption and need tuning with real latency.
- The rollback guard (skip the rollback while another edit is in flight) is a design of this spike. It fixed one clobbering case with two edits. Edits to the same annotation are not covered. TODO: test two edits to the same annotation.
- Each Suspense test took about 300 ms. The probable cause is React throttling how soon a Suspense fallback is replaced by content. That is an assumption and was not isolated.
- A retried PUT that failed on the response path after the server saved it would send the old version again. A server that checks `If-Match` would answer 409. This case was not run. TODO: ANN-020 (annotation persistence API) must decide whether a client edit id makes a repeated PUT idempotent.
- The bundle numbers cover library code only, not the generated client. The Suspense generation was not compared with the committed client in size, because the spike output was not run through Biome. TODO: measure the tree-shaken effect on the app bundle once `apps/web` imports the client.
- Whether the measured sizes matter depends on a budget that does not exist yet. TanStack Query costs 4.7 KB gzip more than SWR and 14.2 KB less than the RTK Query setup in this measurement.

## Follow-ups

- [ADR 0049](../adr/0049-server-state-and-data-fetching.md) records the decision.
- TODO: STACK-024 (realtime transport) must measure event to refetch latency on staging. This spike used a fake source.
- TODO: test paused mutations while offline (`networkMode: "online"` was set but not exercised).
- TODO: test event bursts, for example 50 `annotation.changed` events in 100 ms, to decide whether events need coalescing.
- TODO: add a size entry to this table when the app has a bundle budget.
