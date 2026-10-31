# Local development

How every service in [ADR 0003](../adr/0003-pilot-platform-architecture.md) is reached from a laptop, as decided in [ADR 0004](../adr/0004-cloud-dev-resources.md) and [ADR 0005](../adr/0005-external-sends-only-in-production.md). Only `APP_ENV=prod` talks to Resend, Sentry, Grafana Cloud and PostHog. Each has an override setting for the rare case of testing it elsewhere. FOUND-009 builds this. Postgres and MinIO are the only local services. Everything else runs inside the dev servers or is a free cloud resource.

| Service | Production | Development | Automated tests |
|---|---|---|---|
| Web app | Cloudflare Pages | Vite dev server | Vitest and Playwright |
| Router, tile gateway, realtime | Workers and Durable Objects | The Cloudflare Vite plugin runs the Worker and Durable Objects locally under `vite dev`, so the app is one origin like production | Miniflare through the Workers Vitest pool |
| Slide storage | R2 production bucket | MinIO from `compose.yaml` for the Python API (`STORAGE_*` settings default to it). The Worker's remote binding to the R2 `parfocal-dev` bucket is still planned | Miniflare's in-memory R2 for Worker unit tests. Python tests run against the compose MinIO ([ADR 0121](../adr/0121-s3-client-signed-by-hand-on-httpx2.md), S3 client signed by hand), and INGEST-028 (upload protocol check on the R2 dev bucket) checks the real R2 behaviour on `parfocal-dev` |
| Database | Neon | Docker Compose with `imresamu/postgis:17-3.6.1-alpine3.22` and PgBouncer in transaction mode (`pnpm db:up`) | The same compose stack, in CI as well |
| Python API | FastAPI on Modal | `uv run uvicorn` | pytest with the FastAPI test client |
| Jobs | Modal `spawn` and cron | In-process runner behind the same interface | In-process runner with a fake clock |
| GPU inference | Modal GPU functions | CPU or Apple MPS for small models, or `modal serve` against the dev Modal environment | CPU with tiny fixtures |
| Identity | Zitadel Cloud | The same Zitadel Cloud instance, dev application with `localhost` redirects | Identity faked at the FastAPI dependency. Playwright uses a dedicated test user |
| Email | Resend | Console sender that prints recipient, template and link | In-memory fake sender |
| Errors | Sentry | Console only, no DSN | None |
| Traces, logs, metrics | Grafana Cloud | Console exporters | Console and file exporters, which the SEC-010 scan reads |
| Flags, experiments, analytics | PostHog | Local flag file | Local flag file |

Credentials for development (the dev bucket and Zitadel) live in a git-ignored `.env`, described by a committed `.env.example`. `pnpm api:dev` runs the API on port 8000 with `.env`, and the Vite dev server on port 5173 proxies `/api` to it, so the browser sees one origin as in production. `PUBLIC_ORIGIN` must match the Zitadel app's redirect URI (`http://localhost:5173`), and `SESSION_KEY` is any 32 random bytes in URL-safe base64.

## Settings

The API reads its settings from the environment through `ApiSettings` in `apps/api` and refuses to start when `APP_ENV`, `DATABASE_URL` or a Zitadel setting is missing. `select_clients` in `packages/py-common` picks the email, error, telemetry, analytics and flag clients from `APP_ENV`, and the overrides `EMAIL_BACKEND`, `ERROR_BACKEND`, `TELEMETRY_EXPORT`, `ANALYTICS_BACKEND` and `FLAG_BACKEND` switch one concern at a time. Production clients are passed in as factories, and `prod` refuses to start while any of them is missing, which stays true until STACK-032, STACK-033 and STACK-036 add the SDKs. Local flags come from `FLAG_FILE` (default `flags.json`). `EMAIL_BACKEND=file` appends every email as a JSON line to `EMAIL_OUTBOX` (default `.outbox/email.jsonl`, git-ignored), which is the easiest way to open an invitation link locally.

The web app only sees variables that start with `PARFOCAL_PUBLIC_`. `PARFOCAL_PUBLIC_APP_ENV` is required and `PARFOCAL_PUBLIC_API_BASE_URL` defaults to `/api`. A Vite plugin in `apps/web/vite/public-env.ts` fails the build or dev server when code reads any other `import.meta.env` name or the object as a whole, so a secret cannot reach the bundle by accident.

## Unverified

- A Worker under `vite dev` using a remote R2 binding while its Durable Objects stay local. Confirm in FOUND-009.
