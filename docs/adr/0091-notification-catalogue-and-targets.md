# 0091. Notifications follow one catalogue of kinds with a target and a template each, and links open the notification, which resolves its target (replaces the link form of 0074)

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: NOTIF-006, NOTIF-002, NOTIF-004, NOTIF-007, COLLAB-002, REMOTE-003, CASES-021

## Context

NOTIF-006 asks that every notification has a kind from a documented catalogue and a link to the exact place: a slide at an object, a thread, a task, a job, an evaluation or a failed delivery. [ADR 0074](0074-notifications-as-rows-with-an-email-outbox.md) stores a target type and id per notification and links emails to `/go/{type}/{id}`, which cannot carry the object on a slide or the task the slide belongs to. The web app has no routes yet (SHELL-001), so the server cannot know the final paths. Threads (COLLAB-002) and webhook deliveries (REMOTE-003) do not exist yet.

## Options considered

1. Keep `/go/{type}/{id}` and add query parameters for the object and task. Links stay readable, but each kind needs its own parameters, and the link still has to be checked against what the reader may open.
2. Link to `/go/{notification id}` and let the app ask `GET /api/me/notifications/{id}/target`, which checks that the notification is the caller's and that its target is still open to them, and answers a structured target (kind, project, task, slide, object, job). The app turns that into a route, so routes can change without touching stored rows or sent emails.

## Decision

Option 2.

- `parfocal_api.notifications.CATALOGUE` holds every `NotificationKind` with its target kind, a subject, one plain line for the email and the default channels. The lines name no patient, slide or case, so they are safe for any channel. Three kinds are new: `task-due-soon`, `result-set-added` and `integration-down` (migration `0037`).
- Targets: mention and reply open a thread, task assigned, task due soon and disagreements ready open the task, task signed off opens its evaluation, model run finished, run paused and upload done open the job, result set added opens the slide with the task and object from the payload, integration down opens the failed delivery, and emergency access opens the project.
- The resolver answers 404 `notification-not-found` for someone else's notification, 404 `target-gone` when the target was deleted or is no longer open to the reader (an evaluation for a reviewer, a slide outside their tasks), and 409 `target-not-available` for threads and deliveries until COLLAB-002 and REMOTE-003 add them.
- The route is open to the notification's recipient only, so the permission suite lists it with the reason `own-notification` instead of a workspace permission.

## Consequences

- Emails link to `{origin}/go/{notification id}`. NOTIF-004 renders the catalogue's subject and line into the email.
- COLLAB-002 (threads API) and REMOTE-003 (events out) resolve thread and delivery targets and test them.
- NOTIF-002 (the bell) and CASES-021 (back targets in deep links) read the structured target.
