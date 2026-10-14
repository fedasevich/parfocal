# 0040. Observability with OpenTelemetry, Grafana Cloud and Sentry, and one PHI scrubbing rule set

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-032, FOUND-011, SEC-010, FOUND-010, OPS-006, OPS-007

## Context

[ADR 0003](0003-pilot-platform-architecture.md) names OpenTelemetry to the Grafana Cloud free tier and the Sentry free plan as the defaults. [ADR 0005](0005-external-sends-only-in-production.md) sends nothing outside production. [ADR 0028](0028-data-classes-on-columns.md) gives every column one of five data classes. What is missing is the rule that keeps patient data out of logs, traces and error reports, because those leave the platform when production exports them. FOUND-011 builds the logging pipeline and SEC-010 scans a full E2E run for seeded patient names, so both need one agreed rule set.

Free plan facts, read on 2026-10-14 from third-party summaries. Grafana and Sentry price pages were not read directly, so the numbers must be rechecked before the pilot (TODO).

| Service | Free plan | EU |
|---|---|---|
| Grafana Cloud | About 10,000 active metric series, 50 GB each of logs and traces, 14 days retention, 3 users ([Costbench](https://costbench.com/software/observability/grafana-cloud/free-plan/), [Last9](https://last9.io/blog/grafana-cloud-pricing/)) | Stacks are created in a chosen region and the region cannot be changed afterwards, so a new stack is needed to move ([Grafana docs](https://grafana.com/docs/grafana-cloud/security-and-account-management/region-url-formats/)). TODO: confirm the exact EU region name when the stack is created |
| Sentry Developer | 5,000 errors a month, 1 user ([SigNoz](https://signoz.io/guides/sentry-pricing/), [ADR 0005](0005-external-sends-only-in-production.md)) | EU data residency (Frankfurt) is available on every plan including the free one, at the same price ([Sentry help](https://intercom.help/sentryio/en/articles/13964378)) |

## Options considered

1. OpenTelemetry SDKs to Grafana Cloud free tier, Sentry free plan for errors. Vendor-neutral instrumentation, both have EU regions, no always-on services, and the free quotas fit a pilot. Two vendors, and the free retention is only 14 days.
2. OpenTelemetry to Honeycomb or Datadog. Better query tools, but the free plans are smaller or time limited, and Datadog costs money as soon as the pilot grows. TODO: free limits not checked, because the option lost on other grounds.
3. Self-hosted Grafana, Loki, Tempo and GlitchTip. Full control of where data lives, but always-on services conflict with scale to zero in ADR 0003 and need an operator.
4. PostHog for errors and logs as well. One vendor, but tracing is less mature, and ADR 0003 already rejected it for this.

## Decision

Option 1, with every pipeline passing through one scrubber before anything is written or sent.

Where data goes follows ADR 0005. Production exports OTLP to Grafana Cloud and errors to Sentry in the EU region. Every other environment prints to the console and does not initialise either SDK. The scrubber runs in every environment, so the console output that SEC-010 scans is already scrubbed and a leak shows up in tests, not only in production.

Scrubbing rules, implemented in `parfocal_common.scrubbing`:

| Rule | What it does |
|---|---|
| Allow-list of structured fields | A log `extra` key, span attribute, Sentry tag or Sentry context key is kept only if it is in `ALLOWED_FIELDS`. Every other key keeps its name but its value becomes `[redacted]`. Adding a field to the list is a reviewed code change |
| Deny by data class | A field may be added to the allow-list only if the column or value it carries is `operational` or `public`, or is an id that is `personal` only because it is pseudonymous. Fields of class `phi` and `secret` never go on the list, and neither do free-text `personal` fields such as names and email addresses |
| Ids that may appear | Request id, trace id, span id, tenant id, the pseudonymous user id, and the ids of cases, slides, studies and jobs. They are opaque ids with no name inside. Accession numbers, medical record numbers and file names are not ids in this sense because they can carry identifying text, so they stay off the list |
| Free text | Log messages, exception text, stack info and string values under allowed keys have registered sensitive values replaced by `[redacted]`. Matching ignores case and runs of whitespace. Values shorter than three characters are not registered because they would redact ordinary words |
| Registered sensitive values | The code that reads a patient or staff name, email or identifier registers it with `SensitiveValues` for the lifetime of the request. This is a second line of defence for free text. The first is that code does not log such values |
| Fixed patterns | Email addresses and `Bearer` tokens are redacted without registration |
| Log records | `ScrubbingFilter` is a `logging.Filter` on every handler. It formats the message, redacts it, drops the raw arguments, scrubs extras, and replaces the exception object with redacted text |
| Sentry events | `sentry_before_send` drops `request` (bodies, cookies, headers, query strings), `extra`, `server_name` and `modules`, keeps only `id` of `user`, applies the allow-list to `tags` and `contexts`, and redacts every other string, including exception values and breadcrumbs. `send_default_pii` stays off and session replay stays off |
| OTel spans and metrics | A span processor in each service passes span attributes through `scrub_attributes` before export, and span names must be route templates such as `/cases/{case_id}`. URLs are never attributes in raw form. Metric labels use only allow-listed keys and never ids with high cardinality |
| URLs | Paths carry ids, never names. Search terms and other query values are not logged |
| Frontend | The SPA and the Worker apply the same allow-list and redaction in their own `beforeSend` and exporter hooks. TODO: implement in FOUND-010 and the web error boundary, with a shared list of allowed keys |

Known limits. Registration cannot catch a name that was never registered, and spelling variants such as transliterations or typos are not matched. The allow-list is the stronger control, because free text under a key that is not listed is dropped whole. Code review and SEC-010's E2E scan of seeded names cover the rest.

## Consequences

- FOUND-011 wires `ScrubbingFilter` into JSON logging and adds request, tenant and user context using the allow-listed keys. It depends on this ADR and no longer on a pending research choice.
- FOUND-010 and the web and edge code pass Sentry `before_send` and the OTel span processor through the same rules. TODO: the TypeScript side needs its own implementation and a test with the same allow-list.
- SEC-010 scans console and file exporter output of an E2E run for seeded patient names. The tests here prove the unit rules only.
- Sentry events hold only allow-listed ids, so debugging a failure means joining on request id and tenant id in the logs.
- The 14 day Grafana retention and 5,000 Sentry errors a month are the pilot budget. TODO: set alerts at 70 percent of each quota in OPS-006 and OPS-007.
- No cloud resource was created by this ADR. Creating the Grafana and Sentry projects waits until the owner allows cloud changes.
- Any new data class value or new allow-listed key is a change to this list and needs a test in `packages/py-common/tests/test_scrubbing.py`.
