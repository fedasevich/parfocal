# Result: OpenAPI 3.1 from FastAPI and typed clients under TypeScript 7

- Date: 2026-10-08
- Backlog: STACK-008, STACK-019 (partial)
- Kind: spike
- Commit: 15d686d (the spike lived in a scratch folder outside the repository and is described below)
- Environment: MacBook with Apple M4, macOS 15.8.1, Node 26.9.0, pnpm 12.9.1, Python 3.14.7 through uv 0.12.18
- Data: none

## Question

Can a client with TanStack Query hooks be generated from FastAPI's OpenAPI and compile under the repository's TypeScript 7 settings (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`)? Can a contract test hold the served schema to a committed copy? STACK-019 also asks for Modal cold-start and latency numbers.

## Method

A FastAPI 0.142.4 app with three operations: `getHealth` (`/api/health`), `getMe` (`/api/v1/me`) and `getCase` (`/api/v1/cases/{case_id}`). The last two need a `parfocal_session` cookie that a dependency resolves to a user and tenant from an in-memory table, standing in for the BFF session of STACK-028. `getCase` returns 404 for another tenant's case. `app.openapi()` was written to `openapi.json`, and pytest checked 401 without a session, the tenant scoping and that `GET /openapi.json` equals the committed file.

Clients were generated from `openapi.json` by:

- `@hey-api/openapi-ts` 0.99.0 with the `@hey-api/client-fetch` and `@tanstack/react-query` plugins
- `orval` 8.40.0 with `client: "react-query"`, `httpClient: "fetch"`, `mode: "single"`

Each output was type-checked by TypeScript 7.0.2 with the flags of `packages/typescript-config/base.json` plus the DOM library. Orval ran twice to compare the bytes.

A Modal wrapper (`modal.Image.debian_slim(python_version="3.14")`, `@modal.asgi_app()`, the API module imported only inside the function) was deployed with `modal deploy -e dev`.

## Results

| Check | Result |
|---|---|
| FastAPI schema version | OpenAPI 3.1.0 |
| pytest: 401, tenant scoping, served equals committed | 3 passed |
| Hey API with TypeScript 7.0.2 installed | Crashed: `TypeError: Cannot read properties of undefined (reading 'AnyKeyword')` |
| Hey API with TypeScript 6.0.3 installed | Generated 5 files, 61,583 bytes, in 37 ms |
| Hey API output under TypeScript 7 | 2 errors, TS2379 in `client/client.gen.ts` (`serializedBody: string \| undefined` under `exactOptionalPropertyTypes`) |
| Orval with TypeScript 7.0.2 installed | Generated `api.ts`, 13,005 bytes |
| Orval output under TypeScript 7 | 0 errors, no `any` |
| Orval run twice | Identical bytes |
| `modal deploy -e dev` | Refused: "Workspace … has exceeded its spend limit" |

Hey API declares `typescript >=5.5.3 || >=6.0.0` as a peer and builds its output through the TypeScript compiler API, which the TypeScript 7 package does not provide.

## Interpretation

- Orval works with the repository's TypeScript 7 toolchain as it is. Hey API would need TypeScript 6 installed next to 7 and patches or a looser config for its output.
- The contract test is a plain equality check on the served schema, cheap enough for every pull request.
- STACK-019 has no Modal numbers yet. TODO: measure cold start and warm latency once the Modal spend limit is raised.

## Follow-ups

- [ADR 0017](../adr/0017-orval-api-client.md) records the client generator.
- STACK-019 stays open until the Modal run.
