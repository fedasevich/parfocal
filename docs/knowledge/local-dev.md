# Local development

How every service in [ADR 0003](../adr/0003-pilot-platform-architecture.md) is reached from a laptop, as decided in [ADR 0004](../adr/0004-cloud-dev-resources.md) and [ADR 0005](../adr/0005-external-sends-only-in-production.md). Only `APP_ENV=prod` talks to Resend, Sentry, Grafana Cloud and PostHog. Each has an override setting for the rare case of testing it elsewhere. Postgres, MinIO and, for `make dev`, a local Zitadel are the local services. Everything else runs inside the dev servers or is a free cloud resource.

## make dev

`make dev` runs `scripts/dev.sh`. It installs the packages, writes missing keys into `.env` (`scripts/dev_env.py`), starts the compose stack and the local Zitadel (`infra/local/zitadel-up.sh`), migrates, creates the MinIO bucket, seeds the ČVUT showcase with the test user as owner and runs the API and Vite. The test user is `e2e-pathologist@parfocal.test`, with the password in `.zitadel/test-password`. Every step is safe to repeat. The seed runs as the owner role from `MIGRATION_DATABASE_URL`, because the app role cannot insert workspace settings past row-level security.

The script sources `.env` and then `.zitadel/e2e.env`, so the local Zitadel wins over any Zitadel Cloud values, and it sets the database, storage and origin settings from the ports itself. `PARFOCAL_DEV_IDENTITY=cloud` skips the local Zitadel ([ADR 0342](../adr/0342-make-dev-signs-in-through-the-local-zitadel.md), make dev signs in through the local Zitadel). `PARFOCAL_DEV_PROJECT` names the compose project (default `parfocal`, Zitadel gets `-zitadel` added), and `PARFOCAL_PG_PORT`, `PARFOCAL_POOLER_PORT`, `PARFOCAL_STORAGE_PORT`, `PARFOCAL_ZITADEL_PORT`, `PARFOCAL_MAILPIT_PORT`, `PARFOCAL_WEB_PORT` and `PARFOCAL_API_PORT` move the ports, which lets an agent run a second stack beside the shared one. Ctrl-C stops the API and Vite and leaves the containers running. macOS ships bash 3.2, so the script avoids `wait -n` and other bash 4 features.

| Service | Production | Development | Automated tests |
|---|---|---|---|
| Web app | The edge Worker's static assets | Vite dev server | Vitest and Playwright |
| Router, tile gateway, realtime | Workers and Durable Objects | The Cloudflare Vite plugin runs the Worker and Durable Objects locally under `vite dev`, so the app is one origin like production | Miniflare through the Workers Vitest pool |
| Slide storage | R2 production bucket | MinIO from `compose.yaml` for the Python API (`STORAGE_*` settings default to it). The Worker's remote binding to the R2 `parfocal-dev` bucket is still planned | Miniflare's in-memory R2 for Worker unit tests. Python tests run against the compose MinIO ([ADR 0121](../adr/0121-s3-client-signed-by-hand-on-httpx2.md), S3 client signed by hand), and INGEST-028 (upload protocol check on the R2 dev bucket) checks the real R2 behaviour on `parfocal-dev` |
| Database | Neon | Docker Compose with `imresamu/postgis:18-3.6.1-alpine3.22` and PgBouncer in transaction mode (`pnpm db:up`) | The same compose stack, in CI as well |
| Python API | FastAPI on Modal | `uv run uvicorn` | pytest with the FastAPI test client |
| Jobs | Modal `spawn` and cron | In-process runner behind the same interface | In-process runner with a fake clock |
| GPU inference | Modal GPU functions | CPU or Apple MPS for small models, or `modal serve` against the dev Modal environment | CPU with tiny fixtures |
| Identity | Zitadel Cloud | The local Zitadel in Docker under `make dev`, or the Zitadel Cloud dev application with `PARFOCAL_DEV_IDENTITY=cloud` | Identity faked at the FastAPI dependency. Playwright uses a dedicated test user |
| Email | Resend | Console sender that prints recipient, template and link | In-memory fake sender |
| Errors | Sentry | Console only, no DSN | None |
| Traces, logs, metrics | Grafana Cloud | Console exporters | Console and file exporters, which the SEC-010 scan reads |
| Flags, experiments, analytics | PostHog | Local flag file | Local flag file |

Credentials for development (the dev bucket and Zitadel) live in a git-ignored `.env`, described by a committed `.env.example`. `pnpm api:dev` runs the API on port 8000 with `.env`, and the Vite dev server on port 5173 proxies `/api` to it, so the browser sees one origin as in production. `PUBLIC_ORIGIN` must match the Zitadel app's redirect URI (`http://localhost:5173`), and `SESSION_KEY` is any 32 random bytes in URL-safe base64. `TILE_TOKEN_KEY` is another 32 random bytes in base64, and the edge Worker needs the same value, because it checks the slide capability tokens the API signs ([ADR 0137](../adr/0137-capability-tokens-for-slide-bytes.md)). Without it `getTileAccess` answers 503. A key that is empty, not base64 or shorter than 32 bytes counts as missing in both places: the API answers 503 and the Worker answers 503 `signing-key-not-configured` (SEC-038, keys of at least 32 bytes). `ROOM_TOKEN_KEY` is a separate 32 bytes shared the same way for realtime room tokens, and `REALTIME_INTERNAL_URL` is the edge origin the API posts events to ([ADR 0140](../adr/0140-realtime-rooms-and-room-tokens.md)). Without the key `getRoomAccess` answers 503, and without both the API publishes nothing. Leave `REALTIME_INTERNAL_URL` out of `.env` until an edge runs, because an empty URL fails validation.

## Settings

The API reads its settings from the environment through `ApiSettings` in `apps/api` and refuses to start when `APP_ENV`, `DATABASE_URL` or a Zitadel setting is missing. `select_clients` in `packages/py-common` picks the email, error, telemetry, analytics and flag clients from `APP_ENV`, and the overrides `EMAIL_BACKEND`, `ERROR_BACKEND`, `TELEMETRY_EXPORT`, `ANALYTICS_BACKEND` and `FLAG_BACKEND` switch one concern at a time. Production clients are passed in as factories, and `prod` refuses to start while any of them is missing, which stays true until STACK-032, STACK-033 and STACK-036 add the SDKs. Local flags come from `FLAG_FILE` (default `flags.json`). `EMAIL_BACKEND=file` appends every email as a JSON line to `EMAIL_OUTBOX` (default `.outbox/email.jsonl`, git-ignored), which is the easiest way to open an invitation link locally.

The web app only sees variables that start with `PARFOCAL_PUBLIC_`. `PARFOCAL_PUBLIC_APP_ENV` is required and `PARFOCAL_PUBLIC_API_BASE_URL` defaults to `/api`. A Vite plugin in `apps/web/vite/public-env.ts` fails the build or dev server when code reads any other `import.meta.env` name or the object as a whole, so a secret cannot reach the bundle by accident.

## Unverified

- A Worker under `vite dev` using a remote R2 binding while its Durable Objects stay local. FOUND-009 did not wire the Cloudflare Vite plugin into `apps/web`, so this is still unchecked, and `make dev` was not checked with a slide open in the viewer.
