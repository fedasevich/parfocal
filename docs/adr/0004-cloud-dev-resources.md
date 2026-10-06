# 0004. Use free cloud resources in development instead of local emulators

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: FOUND-009, STACK-032, STACK-036. Replaces rule 5 of [ADR 0003](0003-pilot-platform-architecture.md) and the Resend SMTP choice in its utilities row.

## Context

[ADR 0003](0003-pilot-platform-architecture.md) gave every external service a local stand-in (MinIO, Mailpit, Zitadel in Docker, Spotlight, `grafana/otel-lgtm`, a local flag file). The owner wants as little local infrastructure as possible and asked to use the real services in development wherever their free plans allow it.

Free plans as checked on 2026-10-06. The numbers come from web searches that mixed vendor pages and third-party summaries, so re-check the vendor page before relying on a limit.

| Service | Free plan | Source |
|---|---|---|
| Cloudflare R2 | 10 GB-month storage, 1 million Class A and 10 million Class B operations a month, no egress fees. Then $0.015 per GB-month | https://developers.cloudflare.com/r2/pricing/ |
| Cloudflare Workers and Durable Objects | 100,000 requests a day, SQLite-backed Durable Objects included. Workers Paid ($5 a month) is already planned in ADR 0003 | https://developers.cloudflare.com/durable-objects/platform/pricing |
| Resend | 3,000 emails a month, at most 100 a day, 1 verified domain, sending pauses at the limit | https://resend.com/pricing |
| Neon | 0.5 GB storage and 100 CU-hours per project a month, 10 branches per project, 100 projects, computes suspend after 5 minutes idle | https://neon.com/pricing |
| Modal Starter | $30 of credits a month, 100 containers, 10 concurrent GPUs, limited crons and web endpoints | https://modal.com/pricing |
| Zitadel Cloud | 100 daily active users, 3 identity providers, all security features | https://zitadel.com/pricing |
| Sentry Developer | 1 user, 5,000 errors and 5 million spans a month | https://sentry.io/pricing/ |
| PostHog | 1 million events, 1 million flag requests and 1,500 survey responses a month | https://posthog.com/pricing |
| Grafana Cloud | 10,000 active metric series, 50 GB logs and 50 GB traces a month, 14 days retention | https://grafana.com/pricing/ |

## Options considered

1. Keep the local emulators. Works offline, but there are six more things to run and keep in sync with production behaviour.
2. Use the cloud service in development wherever the free plan covers it, and keep a local service only where the cloud one would hurt daily work.
3. Use the cloud for everything including Postgres. Fewest local pieces, but every query from a local API crosses the internet.

## Decision

Option 2.

| Service | Development uses | Why |
|---|---|---|
| R2 | A `parfocal-dev` bucket in the same Cloudflare account | Free at dev volume. A separate bucket, not the production one, so dev uploads and test clean-ups can never touch pilot data. The local Worker reaches it through a remote binding and Python through the S3 API, so both see the same objects and the `ObjectStore` S3 adapter for the Worker is no longer needed |
| Resend | The real API with Resend's test recipients (such as `delivered@resend.dev`) | Free, and the HTTP API replaces the SMTP path that existed only to share code with Mailpit. Automated tests use an in-memory fake sender, so they never spend the 100-a-day quota that production shares |
| Zitadel | The Zitadel Cloud instance with a separate dev application allowing `localhost` redirects | Free. API tests fake the identity at the FastAPI dependency level. Playwright logs in a dedicated test user with MFA off |
| Sentry | No DSN locally, so errors go to the console. Staging and production report to Sentry | Keeps dev noise out of the 5,000-error quota |
| Grafana Cloud | Console exporters locally, Grafana Cloud for staging and production. A developer can point local traces at Grafana Cloud with `environment=dev` when debugging | 50 GB of traces a month leaves room for that |
| PostHog | A local flag file when no PostHog key is set. Staging and production use PostHog with an `environment` property | Avoids spending flag requests during development |
| Modal | Not needed locally. FastAPI runs under uvicorn and jobs run in-process. `modal serve` runs GPU code against the dev Modal environment | Unchanged from ADR 0003 |
| Postgres | Docker `postgis/postgis:17`, the only local service | API tests run thousands of queries and a local API makes several per request. Over the internet to Neon (likely in the US next to Modal) each query would cost tens of milliseconds or more, and the free plan's 10 branches and 100 CU-hours would be shared with previews. Neon Local is still available when a test needs the real pooler |

The Resend, Sentry, Grafana Cloud and PostHog rows are replaced by [ADR 0005](0005-external-sends-only-in-production.md).

## Consequences

- `docker compose up` starts only Postgres. Everything else is either part of `vite dev` and `uvicorn`, or a cloud service.
- Development needs internet access and credentials for the dev bucket, Zitadel and Resend. They live in a git-ignored `.env` file described by `.env.example`.
- Test slide fixtures larger than the committed synthetic ones are uploaded once to `parfocal-dev` under `fixtures/`. Tests that write use a per-run prefix and delete it afterwards.
- Resend's 100-a-day cap covers every environment of the account. If pilot email volume gets near it, the Pro plan is the fix.
- FOUND-009, STACK-032 and STACK-036 were edited. [knowledge/local-dev.md](../knowledge/local-dev.md) was rewritten.
- TODO: confirm in FOUND-009 that a Worker running under `vite dev` can use a remote R2 binding while its Durable Objects stay local.
- TODO: Modal Starter limits crons and web endpoints. Check the exact numbers before giving every pull request its own Modal environment in OPS-003. Previews may have to share the staging Modal deployment.
