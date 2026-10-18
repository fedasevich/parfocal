# 0092. Each person chooses immediate, hourly or daily email and quiet hours in their own time zone, and mandatory kinds are never held

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: NOTIF-005, NOTIF-004, SET-008

## Context

NOTIF-005 asks for digests and quiet hours. Notifications are rows with an email outbox ([ADR 0074](0074-notifications-as-rows-with-an-email-outbox.md)), and preferences choose channels per kind and workspace. Emergency access must always reach the project's owners at once. A person can belong to several workspaces, and people work in different time zones.

## Options considered

1. Per workspace settings next to the channel preferences. Fine-grained, but a person in three workspaces sets the same quiet hours three times.
2. Per person settings on the user row: an email mode (`off`, `hourly`, `daily`), optional quiet hours (start and end, which may cross midnight) and an IANA time zone. One place, and the hours follow the person.
3. Fixed rules (no email at night in the workspace's zone, daily digest for everyone). Nothing to set, but it fits nobody exactly.

## Decision

Option 2.

- `deliver_pending_emails(connection, sender, origin, now)` groups pending emails per person. Mandatory kinds (emergency access) go out at once, always one email each.
- During quiet hours, in the person's time zone, the other emails stay pending.
- With `hourly` or `daily`, the other emails wait until the oldest of them is an hour or a day old, which batches what arrives in that window.
- When emails go out, one waiting email is sent on its own and several are sent as one `notification.digest` email that links to the inbox (`/inbox`). This also covers emails held overnight with the mode `off`.
- `GET` and `PUT /api/me/email-schedule` read and set the schedule. An unknown time zone or quiet hours with only one end are refused.

## Consequences

- The digest is a template in the reviewed set, with the same three values as the others (NOTIF-004).
- Delivery runs after the commit that created a notification. Held and batched emails need delivery to run again later. TODO: run delivery every few minutes for every workspace once the job runner is deployed (the same cron as retention, [ADR 0089](0089-retention-purge-and-audit-re-anchor.md)).
- SET-008 (notifications section) shows these settings.
