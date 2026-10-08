# 0017. Orval generates the typed API client from FastAPI's OpenAPI 3.1

- Date: 2026-10-08
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-008, FOUND-008, FOUND-018

## Context

The backend is Python, so the web app needs a typed client generated from the API's OpenAPI schema, with TanStack Query hooks (STACK-004) and a CI check that fails when the committed client is stale. The repository compiles with TypeScript 7 and strict flags, including `exactOptionalPropertyTypes` ([ADR 0006](0006-monorepo-tooling.md), [ADR 0008](0008-typescript-internal-packages.md)). The backlog's default was Hey API. Versions were checked on 2026-10-08.

## Options considered

1. Hey API openapi-ts 0.99 with the fetch client and TanStack Query plugin. The output is modular and well typed, but the generator uses the TypeScript compiler API, so it crashes with TypeScript 7 installed and needs TypeScript 6 next to it. Its fetch client also fails to compile under `exactOptionalPropertyTypes`.
2. Orval 8.40 with `react-query` and the fetch HTTP client. It runs with TypeScript 7 installed, its output compiles under the repository's flags with no `any`, and it regenerates byte-identical files. The output is one larger file per spec in single mode, and the hooks are more verbose.
3. tRPC or GraphQL. These were ruled out earlier, tRPC because the backend is Python and GraphQL because REST with OpenAPI is enough here.

## Decision

FastAPI emits OpenAPI 3.1. Orval generates `packages/api-client` with `client: "react-query"` and `httpClient: "fetch"`, Biome formats the output, and both the schema and the client are committed. Every operation has an explicit `operation_id` so the generated names stay stable. A contract test asserts that the served `/openapi.json` equals the committed schema, and CI regenerates the client and fails on any diff. Evidence is in [results/2026-10-08-api-client-codegen-spike.md](../results/2026-10-08-api-client-codegen-spike.md).

## Consequences

- No second TypeScript version is needed, and the client gets the same strict checks as hand-written code.
- Generated hook signatures are long, so app code should wrap them in small domain hooks rather than spreading Orval's types around.
- If Hey API gains TypeScript 7 support and clean output, revisit this with a new ADR.
- FOUND-008 sets up the pipeline and FOUND-018 adds the stale-client check to CI.
