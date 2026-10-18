# 0074. Notifications are rows routed by per-kind preferences, with email sent from an outbox after commit and STACK-036 confirmed

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: NOTIF-000 (research check), NOTIF-001 (notification service), touches NOTIF-002 (the bell), NOTIF-004 (email templates), NOTIF-005 (digest and quiet hours), NOTIF-006 (event catalogue), NOTIF-007 (inbox API), STACK-024 (realtime transport) and ADAPT-010 (emergency access)

## Context

NOTIF-000 asks to confirm STACK-036. [ADR 0039](0039-email-through-resend-with-phi-rules.md) chose Resend through its HTTP API in production only, with no PHI in email, signed bounce webhooks and a suppression list, because Resend states it cannot sign a BAA. Rechecked on 2026-10-18: Resend's own docs still list the free plan at 3,000 emails a month without overage and Pro at 20 USD for 50,000 ([Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing.md)), and third-party summaries add a cap of 100 a day on the free plan ([Costbench](https://costbench.com/software/email-api/resend/free-plan/)). No source found that Resend now signs a BAA. The only explicit statement found is from a competitor ([Paubox](https://docs.paubox.com/email-api/migrate-from-resend.md)), so ADR 0039's own source still stands. Because email carries no PHI, the decision holds.

NOTIF-001 routes events (mention, reply, review task assigned, model run finished or paused, upload done, disagreements ready, task signed off, and emergency access for a clinical project's owners) to in-app, email and realtime channels by preference. There is no realtime transport yet (STACK-024), no job runner yet ([ADR 0044](0044-background-jobs-and-workflows.md) chose Postgres tables with leases), and invitations send their email straight from the request today.

## Options considered

1. Send email from inside the request, as invitations do. Simple, but a request that rolls back after sending has told someone about something that did not happen.
2. Write a notification row in the same transaction, mark email as pending, and send it after commit. Nothing is announced unless it committed, and the same rows serve the bell, the inbox and later realtime pushes.
3. A message broker. Not justified at pilot volume, and ADR 0044 already keeps jobs in Postgres.

## Decision

Option 2.

- `notifications` holds the recipient, the kind, the target type and id, a payload of ids and counts only, whether it shows in the app and is pushed in realtime, the email status (`none`, `pending`, `sent` or `skipped`) and the read time. It is tenant-owned with row-level security, and the recipient must be a member of the workspace.
- `notification_preferences` holds a person's channels per kind. A kind without a row uses the defaults in `parfocal_api.notifications.DEFAULTS`. Email is on by default for mentions, assigned tasks, paused runs, disagreements ready, sign-off and emergency access, and off for replies, finished runs and finished uploads. Emergency access is mandatory: it ignores preferences, and turning it off is refused with 400 `mandatory-notification`.
- `notify()` routes and stores in the caller's transaction, and stores nothing for a person who turned every channel off. `deliver_pending_emails()` sends each pending email once, locked with `SKIP LOCKED`, with the template `notification.{kind}` and a link of the form `{origin}/go/{type}/{id}`. A recipient with no email address is marked skipped. The emergency route runs delivery as a background task after the response, which comes after the transaction committed. TODO: the job runner takes over delivery when it exists.
- Realtime is stored as a choice now and pushed when STACK-024 builds the transport.
- `GET` and `PUT /api/me/notification-preferences` read and change a member's own preferences.
- Emergency access now notifies the project's owners, as ADAPT-010 and [ADR 0066](0066-emergency-access-per-clinical-project.md) planned. The payload holds the hours only, never the reason.

## Consequences

- NOTIF-002 (the bell) and NOTIF-007 (inbox API) read `notifications` where `in_app` is true. NOTIF-006 adds the catalogue with a target and a template per kind, and the `/go/...` link resolves there.
- NOTIF-004 writes the templates for every `notification.{kind}`. Until then the console and memory senders log the template name and the link only.
- NOTIF-005 (digest and quiet hours) can hold pending emails, because delivery is a separate step.
- Every producer (comments, tasks, jobs, uploads, ADJ) calls `notify()` in its own transaction.
