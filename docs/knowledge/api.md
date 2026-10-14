# API conventions

How the FastAPI app in `apps/api` behaves at its edges.

## Errors are RFC 9457 problem details

Every error response has the media type `application/problem+json` and the fields `type`, `title`, `status` and `code`, plus `detail` when it helps and `errors` for 422. `type` is `https://parfocal.eu/problems/{code}`. Raise `BadRequestError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError` or `ConflictError` from `parfocal_api.problems` rather than `HTTPException`, and pass a `detail` only when it is safe to show the user. Unknown routes become `not-found`. Any other exception becomes a 500 `internal` problem with a fixed title, and the exception goes to the error reporter. The OpenAPI schema documents the problem responses on every operation, so the generated client knows them. On the client, `toApiError` in `@parfocal/api-client` turns a response into an `ApiError` with a `kind`. Source: FOUND-012 log entry.

## Validation errors never echo input

FastAPI's default 422 body repeats the submitted value in `input`, which could be a patient name. The problem handler keeps only each field's location, message and code. A contract test submits a patient name in an invalid body and checks that it is absent from the response.

## The client is generated, never edited

`pnpm api:generate` writes `packages/api-client/openapi.json` from `create_app` with placeholder settings, then Orval writes `packages/api-client/src/generated/api.ts` and Biome tidies it ([ADR 0017](../adr/0017-orval-api-client.md)). Run it after changing any route or model and commit both files. `test_openapi_contract.py` fails when the served schema differs from the committed file, and the `test` CI job regenerates and fails on any change. Every route needs an explicit `operation_id`, because the generated function names come from it.

Generated calls go through `apiFetch` in `src/fetcher.ts`, which sends the session cookie, returns `{ data, status, headers }` for success and throws an `ApiError` otherwise. Orval only writes `.ts` in its import of the fetcher when its own `tsconfig` option allows `.ts` imports, which `orval.config.ts` sets inline because the package's `tsconfig.json` is solution-style with no compiler options. `openapi.json` is excluded from Biome, which would otherwise reformat it and break the byte-for-byte contract test.

## Who is calling

`authenticate` in `parfocal_api.auth` reads the session cookie and returns a `SignedInUser` or a `PlatformOperator` from `parfocal_api.principals`. `MemberPrincipal` and `GuestPrincipal` arrive with IAM-005 and IAM-010. Tests that are not about login replace it through `app.dependency_overrides`, which `ApiAs` in `apps/api/tests/db_support.py` wraps so a test calls `api(principal).get(...)`. Never add a header or query switch to pick a principal in application code. See [auth.md](auth.md).

## Every route declares a permission or why it is open

Guard a tenant route with `**require(Permission.X)` from `parfocal_api.permissions`. It refuses roles whose matrix cell is empty and puts `x-permission` into the OpenAPI schema. A route that every member, every signed-in person or nobody signed in may call goes into `OPEN_OPERATIONS` in `apps/api/tests/test_permissions.py` with its reason, and a guarded one needs a request in `GUARDED_CALLS`. The tests fail until one of the two is done. After changing the matrix run `pnpm permissions:doc`. A route that changes something passes `write=True`, which refuses view-only grants, and `test_permissions.py` treats every guarded call that is not a GET as a write. Service accounts reach routes with `Authorization: Bearer pf_...` and only through the permissions in their scopes, so a route that must stay with people checks the principal type, as `/api/me` does ([ADR 0029](../adr/0029-service-accounts-with-own-api-tokens.md)). See [ADR 0026](../adr/0026-roles-and-permission-matrix.md).

## Database dependencies close before the response

`TenantConnection` and `PlatformConnection` use `Depends(..., scope="function")`, so the transaction commits or rolls back before FastAPI sends the response. With the default scope the commit runs after the response is sent, and a failed commit would follow a 200. Source: IAM-004 log entry.
