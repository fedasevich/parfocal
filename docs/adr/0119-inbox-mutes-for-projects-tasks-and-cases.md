# 0119. A person mutes a project, a review task or a case, a muted event is neither stored nor emailed, and mentions and emergency access still get through

- Date: 2026-10-31
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: NOTIF-007 (inbox API), touches NOTIF-002 (the bell), NOTIF-005 (digest and quiet hours), NOTIF-008 (hold notifications while reading), COLLAB-002 (threads API) and SET-008 (notifications section)

## Context

NOTIF-007 asks to "mute a case so its events stop for that person". The task and kit W53 (the inbox page with "Select, Mark read, Mute this case") come from the hospital direction, where every event belonged to a case. Since [ADR 0053](0053-ai-results-review-direction.md) (AI results review direction) the work happens in projects and review tasks, and cases are optional groups of slides inside a project. The catalogue of [ADR 0091](0091-notification-catalogue-and-targets.md) (notification catalogue and targets) points most kinds at a task (task assigned, task due soon, disagreements ready, task signed off) or at a job or project (model runs, uploads, emergency access). Only "result set added" points at a slide, which may sit in a case, and mentions and replies will point at threads on slides when COLLAB-002 (threads API) adds them. A mute that knows only cases would therefore silence almost nothing.

A notification row stores its target type and id ([ADR 0074](0074-notifications-as-rows-with-an-email-outbox.md), notifications as rows with an email outbox), so it cannot tell which project, task or case it belongs to without a lookup per kind. Per-kind preferences already turn whole kinds off, and emergency access is mandatory.

## Options considered

1. Mute cases only, as the task was written. It matches the wording, but in the review direction it only reaches "result set added" and, later, threads on case slides. A reviewer flooded by one task's due-soon and disagreement events could not stop them.
2. Mute a project, a review task or a case. Each notification stores the project, task and case it belongs to, filled by `notify()` from its target, and a notification is muted when any of the three is muted. A project mute covers its jobs, uploads and every task. Cases still work where cases exist. It needs three columns and a lookup when a notification is made.
3. Option 2 plus slides. A slide's events reach a person through a task, a case or the project anyway, and a slide-level mute would only add a long list of mutes that nobody can review. It also cannot catch task-level events about that slide.
4. Keep muted events as hidden rows instead of not storing them. Unmuting could then show what was missed, but the inbox, the counts, the bell and every delivery path would need to skip a flag, and a person who muted something said they do not want it.

For mentions there are two choices. Either a mute silences everything about its subject, or a mention, which a colleague writes to one person on purpose, still arrives. Slack and GitHub both let a direct mention through a muted channel or thread, and a person who muted a busy task would otherwise miss a question addressed to them.

## Decision

Option 2, with mentions and mandatory kinds getting through.

- `notifications` gains `project_id`, `task_id` and `case_id` (migration `0041`, inbox mutes, which also fills existing rows). `notify()` reads them from the target: a task or evaluation gives its project and task, a slide its project and case with the task from the payload, a job its project, and a project itself. Threads and deliveries give nothing until COLLAB-002 (threads API) and REMOTE-003 (events out) add them, and a target that cannot be found gives nothing.
- `notification_mutes` holds one row per person and subject (`project`, `task` or `case` and its id). It is tenant-owned with row-level security and cascades from the membership.
- `notify()` stores nothing for a recipient who muted the notification's project, task or case, unless the kind is a mention or mandatory (emergency access). Nothing stored means no inbox row, no realtime push and no email.
- Muting also marks that person's pending emails for the same subject as skipped, so a digest or quiet-hours hold does not send them later. Notifications already in the inbox stay there and can be marked read.
- `PUT /api/me/notification-mutes/{subject}/{id}` mutes and `DELETE` unmutes, and both answer the person's mutes. A person can mute only what they can read: a project they hold a role in or reach through emergency access, a task they read, or a case with slides they read. Anything else is 404 `mute-subject-not-found`. `GET /api/me/notification-mutes` lists them.
- The inbox (`GET /api/me/notifications`) lists the person's in-app notifications filtered by kinds and read state, in keyset pages like My work, with the kind, a `/go/{id}` link, the target type and id, the payload, the three context ids, the read time and the creation time. The target itself is still resolved on open through `GET /api/me/notifications/{id}/target`, as ADR 0091 decided, so a page needs no permission check per row. `GET /api/me/notifications/counts` gives the total and unread count per kind for the bell's tabs and the inbox filters. `POST /api/me/notifications/read` marks the given ids, or all of them with optional kinds and an `up_to` time, and changes only the caller's unread rows.

## Consequences

- Unmuting does not bring back what was missed. Per-kind preferences still decide channels for everything that is not muted.
- COLLAB-002 (threads API) must give mentions and replies their project, task and case when it resolves thread targets, or a mute will not catch replies. A thread mute, if wanted, is a new subject kind there.
- NOTIF-002 (the bell) groups kinds into For me, Mentions and Jobs on the client from the counts and the `kind` filter. NOTIF-008 (hold notifications while reading) holds pushes of rows that are stored, so it needs nothing from mutes.
- SET-008 (notifications section) can show and remove mutes with the list route.
- The data map, the permission page and the tenant isolation suite gained the new columns, routes and table.
