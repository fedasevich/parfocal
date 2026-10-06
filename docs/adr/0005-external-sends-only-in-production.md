# 0005. Send email, telemetry and analytics only from production

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: FOUND-009, FOUND-010, STACK-032, STACK-033, STACK-036, SEC-010, OPS-006, OPS-007. Replaces the Resend, Sentry, Grafana Cloud and PostHog rows of [ADR 0004](0004-cloud-dev-resources.md).

## Context

[ADR 0004](0004-cloud-dev-resources.md) had development send real email through Resend, and had staging report to Sentry, Grafana Cloud and PostHog. The owner does not want email, logs or telemetry leaving any environment except production. Outside production, those messages are noise, and they spend free quotas (Resend 100 emails a day, Sentry 5,000 errors a month) that production needs.

## Options considered

1. Keep sending from every environment with an `environment` tag. Staging problems show up in Sentry, but quotas are shared and every environment needs credentials.
2. Send only from production, and log everything to the console elsewhere. No quota use and no vendor credentials outside production, but staging problems are only visible in its own logs.
3. Option 2 with environment checks written at each call site. Easy to start, but checks get forgotten and scattered.

## Decision

Option 2, with the choice made once at startup.

One setting, `APP_ENV`, takes the value `dev`, `test`, `preview`, `staging` or `prod`. FastAPI, the edge Worker and the web app read it from config at startup and pick an implementation for each concern. Feature code calls the interface and never checks the environment itself.

| Concern | `prod` | Every other environment |
|---|---|---|
| Email | Resend | Console sender that prints recipient, template and link. Automated tests use an in-memory fake |
| Errors | Sentry in the SPA, the Worker and FastAPI | SDK not initialised, errors go to the console |
| Traces, metrics, logs | OTLP export to Grafana Cloud, Workers Logs on | Console exporter and readable logs, Workers Logs off in the non-production wrangler environments |
| Product analytics and surveys | PostHog | Nothing sent |
| Feature flags | PostHog | Defaults from a local flag file |

Each concern has its own override setting, such as `EMAIL_BACKEND=resend` or `TELEMETRY_EXPORT=otlp`. A developer uses one to test a real email template, and staging uses them during the OPS-006 and OPS-007 drills. The default always follows `APP_ENV`.

Modal keeps its own platform logs in every environment, which cannot be switched off and costs nothing extra.

## Consequences

- Development and previews need no credentials for Resend, Sentry, Grafana Cloud or PostHog.
- The free quotas are spent only by production, so they are the pilot's real budget.
- Staging errors are not in Sentry by default. Read staging logs, or switch export on with the override while investigating.
- SEC-010 scans the captured console and file output of the E2E run, because non-production environments do not export.
- A test in FOUND-010 proves that with any `APP_ENV` other than `prod` no client for Resend, Sentry, Grafana Cloud or PostHog is created.
- FOUND-009, FOUND-010, STACK-032, STACK-033, STACK-036, SEC-010, OPS-006 and OPS-007 were edited, and [knowledge/local-dev.md](../knowledge/local-dev.md) was updated.
