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

`authenticate` in `parfocal_api.auth` reads the session cookie and returns a `SignedInUser` or a `PlatformOperator` from `parfocal_api.principals`. `MemberPrincipal` arrives with IAM-005, and `ServicePrincipal` comes from an API token. The guest principal was removed by ADAPT-001 ([ADR 0060](../adr/0060-no-sign-out-permissions-or-guest-scope.md)). Tests that are not about login replace it through `app.dependency_overrides`, which `ApiAs` in `apps/api/tests/db_support.py` wraps so a test calls `api(principal).get(...)`. Never add a header or query switch to pick a principal in application code. See [auth.md](auth.md).

## Every route declares a permission or why it is open

Guard a tenant route with `**require(Permission.X)` from `parfocal_api.permissions`. It refuses roles whose matrix cell is empty and puts `x-permission` into the OpenAPI schema. A route that every member, every signed-in person or nobody signed in may call goes into `OPEN_OPERATIONS` in `apps/api/tests/test_permissions.py` with its reason, and a guarded one needs a request in `GUARDED_CALLS`. The tests fail until one of the two is done. After changing the matrix run `pnpm permissions:doc`. A route that changes something passes `write=True`, which refuses view-only grants, and `test_permissions.py` treats every guarded call that is not a GET as a write. Service accounts reach routes with `Authorization: Bearer pf_...` and only through the permissions in their scopes, so a route that must stay with people checks the principal type, as `/api/me` does ([ADR 0029](../adr/0029-service-accounts-with-own-api-tokens.md)). A route that must allow fewer roles than its matrix cell needs its own check and a test for it. The tenant isolation suite gives each GET route in `GET_ROUTES` the role that may call it. See [ADR 0061](../adr/0061-researcher-reviewer-and-admin-roles.md).

## Database dependencies close before the response

`TenantConnection` and `PlatformConnection` use `Depends(..., scope="function")`, so the transaction commits or rolls back before FastAPI sends the response. With the default scope the commit runs after the response is sent, and a failed commit would follow a 200. Source: IAM-004 log entry.

## Project routes go through project_access

A route that touches a project's cases or slides reads the effective grant from `parfocal_api.project_access.project_grant`, which combines the workspace grant with the person's project role through `permissions.in_project`. Reads call `require_reading`, which answers 404 to members without read access and to anyone outside a de-identified project, and 403 `emergency-access-needed` to researchers and admins outside a clinical project. Lists filter with `readable`. Service accounts skip project roles and keep their workspace scopes. Never check `project_members` by hand in a route ([ADR 0065](../adr/0065-project-role-enforcement.md)).

## Test helpers for workspaces and projects

`tests/workspace_support.py` makes a workspace with people (`make_workspace`), a project (`make_project`) and a project role (`join_project`), and `tests/case_support.py` seeds a project with a case, slides and a loose slide. A test that reads cases must give its principal a project role first, or it gets 404. `test_project_roles.py` computes the expected status of every project route from the matrix, so a new project route only needs an entry in `OPERATIONS`.

## The permission matrix test runs calls in a fixed order

`test_every_guarded_endpoint_follows_the_matrix_for_every_role` runs the calls in `GUARDED_CALLS` sorted by operation name, once per role, against one shared workspace. A call that changes state must not break a later one. Archive and restore act on `spare_project`, emergency access asks for `outside_project`, and `revokeInvitation` pops one seeded invitation per role. Building `PLACEHOLDER` runs every lambda once at import, so a test that reuses it copies it with fresh lists (`dataclasses.replace`). The tenant isolation suite gives each GET route in `GET_ROUTES` the role that may call it, because no single role reads them all.

## Logging

Log with `logging.getLogger("parfocal....")` and put values in `extra` under keys from `scrubbing.ALLOWED_FIELDS`. Any other key is written as `[redacted]`. Code that reads a name, email or identifier calls `structured_logging.register_sensitive` so the rest of the request cannot leak it, as `identifiers.read_patient` does. Tests capture output with `configure_logging(..., stream=io.StringIO())` and must remove the handler afterwards, and should filter lines by logger name because the test client's `httpx2` logs each call ([ADR 0068](../adr/0068-structured-logging-on-the-standard-library.md)).
