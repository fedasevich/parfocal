# 0339. SLOs and alert rules live in code, burn by two windows and reach on-call by email

- Date: 2026-11-15
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: OPS-007 (alerting and on-call). Touches OPS-006 (observability stack), SEC-018 (incident response runbook) and OPS-013 (email routing for support and security)

## Context

OPS-007 asks for SLOs on availability, tile latency, ingest time and pre-read time, alerts routed to on-call, a security alert on audit events that cross workspaces (from the tabletop exercise of 2026-11-04), and a fault-injection test for every alert. Nothing emits SLI data yet, because OPS-006 is not done. [ADR 0005](0005-external-sends-only-in-production.md) (external sends only in production) keeps Grafana Cloud, Sentry and Resend off outside production, there is no staging ([ADR 0331](0331-no-staging-environment.md), no staging environment), one person is on call, and the budget is $30 a month.

## Options considered

1. Write the rules in Grafana Cloud alerting and route through Grafana contact points. Native dashboards, but rules live only in a vendor UI, cannot be tested locally and wait for an account.
2. Write SLOs, burn-rate rules and routing as Python in `parfocal_common.alerting`, test them against fakes, and send through the existing `EmailSender`. Testable today and vendor-neutral. Grafana rules, if wanted later, are generated from the same definitions.
3. Add a paging service such as PagerDuty or Opsgenie. Real paging, but a new paid or limited service for one person.

## Decision

Option 2.

| SLO | SLI event | Target over 30 days | Source of the threshold |
|---|---|---|---|
| Availability | `sli.api.request` | 99.5 percent of requests without a 5xx | Initial target. Cold starts of 7 to 12 s ([result](../results/2026-11-13-modal-cold-start-and-api-latency.md)) count as available |
| Tile latency | `sli.tile.fetch` | 95 percent within 60 ms at the edge | The TILES-002 (CDN in front of slide storage) budget, warm p95 under 60 ms ([result](../results/2026-11-02-tile-gateway-latency.md)) |
| Ingest time | `sli.ingest.slide` | 95 percent of slides viewable within 10 minutes of upload | Initial target, not measured. TODO |
| Pre-read time | `sli.pre-read.slide` | 95 percent of AI pre-reads ready within 60 minutes of the slide being ready | Initial target, not measured. TODO |

Alerts use the multi-window burn rate rules of the Google SRE workbook: a page when the budget burns 14.4 times too fast over 1 hour and 5 minutes, or 6 times over 6 hours and 30 minutes, and a ticket at 1 time over 3 days and 6 hours. An alert mails once when it starts and once when it resolves. Pages go to `ALERT_PAGE_EMAIL` and tickets to `ALERT_TICKET_EMAIL`, both `security@parfocal.eu` by default. Quota rules open a ticket at 70 percent of a free quota, as [ADR 0040](0040-observability-and-phi-scrubbing.md) (observability and PHI scrubbing) asks, with the limits passed in because that ADR marks its figures unverified.

The cross-workspace security alert lives in `parfocal_api.security_alerts`. An audit event records the actor's workspace in `tenant_id`. For each workspace, under that workspace's own row-level scope, the watch looks for events by members or service accounts whose target row is not visible in that workspace, so it never reads another workspace's rows. Every `AuditTarget` is either mapped to its table or exempt with a reason, and a test fails when a new target is neither. A per-workspace `seq` watermark stops repeat alerts.

## Consequences

- Every SLO has a fault-injection test against a fake upstream (server errors, slow storage, stalled conversion, a stuck GPU queue), and the security alert has one against Postgres, which also proves ordinary activity stays quiet.
- Outside production alerts go to the console. A drill sets `EMAIL_BACKEND=resend` to send them for real, as ADR 0005 allows.
- OPS-006 must emit the four SLI event names through `Instrument` and run `evaluate_slos` and `CrossWorkspaceWatch.check` on a schedule. Until then nothing in production evaluates the rules.
- A target row purged by retention after its event can look cross-workspace. The watermark keeps the window short, so this is rare, and the runbook query tells the two apart.
- Email is not a phone page. If one person cannot watch the inbox, a paging service is a new ADR.
