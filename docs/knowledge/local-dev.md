# Local development

How every service in [ADR 0003](../adr/0003-pilot-platform-architecture.md) is reached from a laptop, as decided in [ADR 0004](../adr/0004-cloud-dev-resources.md) and [ADR 0005](../adr/0005-external-sends-only-in-production.md). Only `APP_ENV=prod` talks to Resend, Sentry, Grafana Cloud and PostHog. Each has an override setting for the rare case of testing it elsewhere. FOUND-009 builds this. Postgres is the only local service. Everything else runs inside the dev servers or is a free cloud resource.

| Service | Production | Development | Automated tests |
|---|---|---|---|
| Web app | Cloudflare Pages | Vite dev server | Vitest and Playwright |
| Router, tile gateway, realtime | Workers and Durable Objects | The Cloudflare Vite plugin runs the Worker and Durable Objects locally under `vite dev`, so the app is one origin like production | Miniflare through the Workers Vitest pool |
| Slide storage | R2 production bucket | R2 `parfocal-dev` bucket, through a remote binding from the Worker and the S3 API from Python | Miniflare's in-memory R2 for Worker unit tests. Python integration tests use `parfocal-dev` with a per-run prefix that is deleted afterwards |
| Database | Neon | Docker `postgis/postgis:17` | The same container, or the CI service container. Neon Local when a test needs the real pooler |
| Python API | FastAPI on Modal | `uv run uvicorn` | pytest with the FastAPI test client |
| Jobs | Modal `spawn` and cron | In-process runner behind the same interface | In-process runner with a fake clock |
| GPU inference | Modal GPU functions | CPU or Apple MPS for small models, or `modal serve` against the dev Modal environment | CPU with tiny fixtures |
| Identity | Zitadel Cloud | The same Zitadel Cloud instance, dev application with `localhost` redirects | Identity faked at the FastAPI dependency. Playwright uses a dedicated test user |
| Email | Resend | Console sender that prints recipient, template and link | In-memory fake sender |
| Errors | Sentry | Console only, no DSN | None |
| Traces, logs, metrics | Grafana Cloud | Console exporters | Console and file exporters, which the SEC-010 scan reads |
| Flags, experiments, analytics | PostHog | Local flag file | Local flag file |

Credentials for development (the dev bucket and Zitadel) live in a git-ignored `.env`, described by a committed `.env.example`.

## Unverified

- A Worker under `vite dev` using a remote R2 binding while its Durable Objects stay local. Confirm in FOUND-009.
