# API conventions

How the FastAPI app in `apps/api` behaves at its edges.

## Errors are RFC 9457 problem details

Every error response has the media type `application/problem+json` and the fields `type`, `title`, `status` and `code`, plus `detail` when it helps and `errors` for 422. `type` is `https://parfocal.eu/problems/{code}`. Raise `BadRequestError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError` or `ConflictError` from `parfocal_api.problems` rather than `HTTPException`, and pass a `detail` only when it is safe to show the user. Unknown routes become `not-found`. Any other exception becomes a 500 `internal` problem with a fixed title, and the exception goes to the error reporter. The OpenAPI schema documents the problem responses on every operation, so the generated client knows them. On the client, `toApiError` in `@parfocal/api-client` turns a response into an `ApiError` with a `kind`. Source: FOUND-012 log entry.

## Validation errors never echo input

FastAPI's default 422 body repeats the submitted value in `input`, which could be a patient name. The problem handler keeps only each field's location, message and code. A contract test submits a patient name in an invalid body and checks that it is absent from the response.

## The client is generated, never edited

`pnpm api:generate` writes `packages/api-client/openapi.json` from `create_app` with placeholder settings, then Orval writes `packages/api-client/src/generated/api.ts` and Biome tidies it ([ADR 0017](../adr/0017-orval-api-client.md)). Run it after changing any route or model and commit both files. `test_openapi_contract.py` fails when the served schema differs from the committed file, and the `test` CI job regenerates and fails on any change. Every route needs an explicit `operation_id`, because the generated function names come from it.

Generated calls go through `apiFetch` in `src/fetcher.ts`, which sends the session cookie, returns `{ data, status, headers }` for success and throws an `ApiError` otherwise. Orval only writes `.ts` in its import of the fetcher when its own `tsconfig` option allows `.ts` imports, which `orval.config.ts` sets inline because the package's `tsconfig.json` is solution-style with no compiler options. `openapi.json` is excluded from Biome, which would otherwise reformat it and break the byte-for-byte contract test.
