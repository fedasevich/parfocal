# Subprocessors

This is the list of services that process personal data for Parfocal, written for SEC-021 (GDPR documentation) and GDPR Articles 28 and 44 to 46. Every fact comes from [knowledge/platform.md](../knowledge/platform.md) or an ADR, which the source column names. Read on 2026-11-03.

Simulated check, no such person took part. Agents wrote this page where counsel or a privacy professional would write or review it ([agent-stand-in-records.md](../project/agent-stand-in-records.md)).

The pilot holds only public slide datasets with seeded fake patients ([ADR 0003](../adr/0003-pilot-platform-architecture.md), pilot platform architecture). When the first tenant with real patient data arrives, ADR 0003 requires a signed DPA with every processor below, pinned EU regions and SEC-005 (data residency enforcement). This list must be checked again on that day and before every new service.

## In use

| Service | What it does for Parfocal | Personal data it receives | Where the data sits | Plan | Contract status | Source |
|---|---|---|---|---|---|---|
| Cloudflare (Workers, R2, DNS, rate limiting) | Serves the web app, the API gateway and slide tiles, stores slides and uploads in R2, counts requests per client address | Slide files and their names, every request passing the Worker including the session cookie, client IP addresses for rate limits | R2 buckets `parfocal-<env>` with location hint `eeur` and the default jurisdiction, not the EU jurisdiction. Workers run on Cloudflare's global edge | Workers Paid planned, R2 Paid | TODO: DPA not checked. A BAA needs an enterprise plan | [ADR 0003](../adr/0003-pilot-platform-architecture.md), `infra/tofu/cloudflare.tf`, platform.md |
| Modal | Runs FastAPI, ingest, background jobs and GPU model runs | Everything the API reads or writes, including slide pixels during model runs | No region pin, so Modal chooses where containers run. Pinning to `eu` costs 1.15 times | Starter | TODO: DPA not checked. HIPAA only on Enterprise | [ADR 0003](../adr/0003-pilot-platform-architecture.md), [ADR 0147](../adr/0147-cloud-provider-regions-and-pilot-cost.md), platform.md |
| Neon | Postgres database for every table in the [data map](../reference/data-map.md) | Accounts, sessions, audit log, review work, and in clinical projects encrypted patient identifiers | US East (`iad1`) today. The final region is a TODO of STACK-020 (database hosting) | Free, billed through the Vercel Marketplace | TODO: DPA not checked. A BAA needs the Scale plan | [ADR 0147](../adr/0147-cloud-provider-regions-and-pilot-cost.md), STACK-020 notes in the ADRs, platform.md |
| Zitadel Cloud | Sign-in, MFA and organisations | Email, name, sign-in events and MFA factors of every user | EU region | Free, 100 daily active users | TODO: DPA not checked | [ADR 0025](../adr/0025-zitadel-bff-login.md), platform.md |

## Planned, no account yet

These run only in production ([ADR 0005](../adr/0005-external-sends-only-in-production.md), external sends only in production). Each gets a row above, a cap and a row in platform.md on the day its account is created.

| Service | What it will do | Personal data it will receive | Where the data sits | Contract status | Source |
|---|---|---|---|---|---|
| Resend | Transactional email | Recipient email and the message, which must hold no patient data | United States. Resend states a pre-signed Article 28 DPA with SCCs and the EU-US Data Privacy Framework on every plan | Accept the DPA when the account is created | [ADR 0039](../adr/0039-email-through-resend-with-phi-rules.md) |
| Sentry | Error reports from the web app, the Worker and the API | Pseudonymous user id and allow-listed tags only, after the scrubber | EU region (Frankfurt), available on the free plan | TODO | [ADR 0040](../adr/0040-observability-and-phi-scrubbing.md) |
| Grafana Cloud | Traces, metrics and logs | Allow-listed fields only, after the scrubber, kept 14 days | A stack in a chosen EU region. TODO: the exact region name | TODO | [ADR 0040](../adr/0040-observability-and-phi-scrubbing.md) |
| PostHog Cloud | Feature flags, experiments and product analytics | Pseudonymous user id and event names with allow-listed properties, never patient data | TODO: choose the EU cloud when the account is created | TODO | [ADR 0003](../adr/0003-pilot-platform-architecture.md), STACK-033, [ADR 0171](../adr/0171-analytics-without-device-storage.md) |

## Not subprocessors

- GitHub holds the code, CI and test fixtures of public datasets. No workspace data goes there.
- Vercel bills the Neon plan. The repository shows no workspace data passing through it.
- The evaluation datasets of [ADR 0093](../adr/0093-evaluation-metrics-and-datasets.md) hold no personal data about Parfocal's users or patients.

## Transfers outside the EEA

Neon in US East, Resend and any Modal container placed outside the EEA are transfers under Chapter V. During the pilot they carry no real patient data. Before real patient data the options are an EU region (Neon, Modal `eu`, the R2 EU jurisdiction) or SCCs with a transfer impact assessment. Parfocal does not rely on the Article 49 derogations. TODO: the owner and counsel choose per service when the PHI trigger fires.
