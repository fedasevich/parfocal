# API conventions

How the FastAPI app in `apps/api` behaves at its edges.

## Errors are RFC 9457 problem details

Every error response has the media type `application/problem+json` and the fields `type`, `title`, `status` and `code`, plus `detail` when it helps and `errors` for 422. `type` is `https://parfocal.eu/problems/{code}`. Raise `BadRequestError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError` or `ConflictError` from `parfocal_api.problems` rather than `HTTPException`, and pass a `detail` only when it is safe to show the user. Unknown routes become `not-found`. Any other exception becomes a 500 `internal` problem with a fixed title, and the exception goes to the error reporter. The OpenAPI schema documents the problem responses on every operation, so the generated client knows them. On the client, `toApiError` in `@parfocal/api-client` turns a response into an `ApiError` with a `kind`. Source: FOUND-012 log entry.

## Validation errors never echo input

FastAPI's default 422 body repeats the submitted value in `input`, which could be a patient name. The problem handler keeps only each field's location, message and code. A contract test submits a patient name in an invalid body and checks that it is absent from the response.
