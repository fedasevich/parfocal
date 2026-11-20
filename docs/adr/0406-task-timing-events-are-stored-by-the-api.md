# 0406. Task timing events are stored by the API without person, case or slide ids

- Date: 2026-11-20
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-082 (the task timing page reads recorded timing events)

## Context

The task timing page at `/kpi` read the timing events kept in the browser's own event log and fell back to a seeded sample, so PROTO-079 (the deployed app carries no prototype scenes or mock views) put it behind dev tools. The events are the five timing names of ADR 0274 (the analytics event taxonomy): `task_finished`, `area_time_recorded`, `cell_review_timed`, `chrome_coverage_measured` and `reading_time_compared`. They also go to product analytics, which has no read path for the app and no key the API holds.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Read the figures back from PostHog with a personal API key | No new table | A secret with read rights over all analytics, a vendor call per page view, and nothing in local dev or tests |
| 2. The browser posts each timing event to the API, which stores it in a tenant table | Works in every environment, tested with the database, the workspace sees only its own rows | A migration and a small write per finished task |
| 3. Keep the page on device events only | Nothing to build | The page shows one person's browser, which is not a workspace measure |

## Decision

Option 2.

- `POST /api/me/timing-events` (`recordTimingEvents`) takes up to 50 events. Each carries only its name, task kind, area and the millisecond or permille numbers its name needs, and anything else is a 422. Nothing that names a person, case or slide is sent or stored.
- The API stores the events only when analytics are allowed, by the same rule as the browser: the workspace policy `on` records, `off` records nothing, and `person` follows the person's `analytics_opt_out`. A refused batch answers 200 with `recorded: 0`.
- Rows live in `timing_events` (migration 0142) with tenant isolation. `GET /api/tenant/task-timing` (`getTaskTiming`) returns the latest 5000 rows to members with workspace settings rights, the same right as the corrections card on the page.
- `/kpi` is a product route again and shows an empty state when nothing is recorded.

## Consequences

- The figures start from the day this ships. Older timing lives only in product analytics.
- Rows hold no personal data, so erasing a person leaves them. A retention rule for the table is a later task if the row count grows.
