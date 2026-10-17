# 0068. JSON logs from the standard library, with request context in a context variable and one access line per request

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: FOUND-011 (structured logging with tenant and request context), touches SEC-010 (PHI-safe telemetry) and FOUND-010 (observability wiring)

## Context

[ADR 0040](0040-observability-and-phi-scrubbing.md) set the PHI rules and put them in `parfocal_common.scrubbing`: an allow-list of structured fields, registered sensitive values per request, fixed patterns and a `ScrubbingFilter` for log records. FOUND-011 has to turn that into JSON logs that carry the request id, the workspace id and the pseudonymous user id, and prove that a patient name passed to a logger is redacted.

## Options considered

1. structlog. Rich processors and bound loggers, but the scrubbing filter is a `logging.Filter`, uvicorn, SQLAlchemy and httpx log through the standard library anyway, and a second pipeline would need the same rules twice.
2. python-json-logger with the standard library. Only the formatter, which is about 40 lines of our own code, and one more dependency to keep current.
3. The standard library with our own `JsonFormatter`, a `ContextFilter` that copies a context variable onto each record, and the existing `ScrubbingFilter`.

## Decision

Option 3, in `parfocal_common.structured_logging`.

- `log_context()` opens a `LogContext` with a request id and its own `SensitiveValues`, so names registered in one request never affect another. `bind()` adds the workspace and user ids, and `register_sensitive()` adds values to redact.
- `StructuredHandler` writes one JSON object per line with `time`, `level`, `logger`, `message`, `service`, `environment`, the context fields and any allow-listed extras. Its filters run in order: context first, then scrubbing. `configure_logging()` installs it on the root logger once and replaces an earlier one.
- In the API, the ASGI middleware `RequestLogging` opens the context, keeps an incoming `X-Request-Id` when it is 8 to 64 characters of letters, digits, dot, dash or underscore, issues one otherwise, returns it in the response, and logs `request finished` with the method, the route template, the status and the duration. The raw path is never logged, because it carries ids that are not on the allow-list.
- `tenant_connection` and `user_connection` bind the workspace and user ids. `users.id` is a random UUID, which is the pseudonymous user id that ADR 0040 allows.
- `identifiers.add_patient` and `read_patient` register the patient's name and MRN, so any later log line in the same request has them redacted even if code logs them by mistake.

## Consequences

- Library loggers that log URLs, such as `httpx2`, still pass through the scrubber, but their messages keep ids in paths. TODO: SEC-010 (PHI-safe telemetry) checks that no library logs query strings with names.
- Workers call `configure_logging` with their own service name when they first log. TODO: INGEST-003 (ingest workflow skeleton) wires it into the worker entry point.
- FOUND-010 adds the OTel trace and span ids to the same context fields.
