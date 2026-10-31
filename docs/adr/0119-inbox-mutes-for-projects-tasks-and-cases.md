# 0119. A person mutes a project, a review task or a case, muted events stay in the inbox without a push or an email, and mentions, emergency access and work handed to the person still get through

- Date: 2026-10-31
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: NOTIF-007 (inbox API), touches NOTIF-002 (the bell), NOTIF-005 (digest and quiet hours), NOTIF-008 (hold notifications while reading), COLLAB-002 (threads API) and SET-008 (notifications section)

## Context

NOTIF-007 asks to "mute a case so its events stop for that person". The task and kit W53 (the inbox page with "Select, Mark read, Mute this case") come from the hospital direction, where every event belonged to a case. Since [ADR 0053](0053-ai-results-review-direction.md) (AI results review direction) the work happens in projects and review tasks, and cases are optional groups of slides inside a project. The catalogue of [ADR 0091](0091-notification-catalogue-and-targets.md) (notification catalogue and targets) points most kinds at a task (task assigned, task due soon, disagreements ready, task signed off) or at a job or project (model runs, uploads, emergency access). Only "result set added" points at a slide, which may sit in a case, and mentions and replies will point at threads on slides when COLLAB-002 (threads API) adds them. A mute that knows only cases would therefore silence almost nothing, so a person mutes a project, a review task or a case. Slides are left out, because a slide's events reach a person through one of those three, and a list of slide mutes would be long and impossible to review.

A notification row stores its target type and id ([ADR 0074](0074-notifications-as-rows-with-an-email-outbox.md), notifications as rows with an email outbox), so it cannot tell which project, task or case it belongs to without a lookup per kind. Per-kind preferences already turn whole kinds off, and emergency access is mandatory.

The first version of this record dropped muted events. The owner asked on 2026-10-31 that muting must not throw notifications away, which reopened what a mute does with an event.

## Options considered

1. Drop muted events. `notify()` stores nothing for a person who muted the subject, so there is no inbox row, no push and no email. It is the simplest, but what was muted is lost for good, a person cannot look back at what happened in a muted project, and an assignment or a due date in a muted task never reaches the reviewer it is meant for.
2. Keep muted events and silence them. Every event is stored, and a muted one carries a `muted` flag, never pushes and never emails or joins a digest. The inbox shows it under a filter and the bell does not count it. Nothing is lost, at the cost of one column and a filter in the list and the counts. A reviewer who mutes a busy task still misses that it was handed to them or that it is due.
3. Keep muted events and silence them, but let the kinds that are addressed to the person's own work through as normal notifications. A mute is for noise about other people's activity, while an assignment, a reassignment, a nudge or a due date is a request to the person. Slack and GitHub let a direct mention through a muted channel or thread for the same reason. Each catalogue entry declares whether it gets through, so a new kind has to decide.

## Decision

Option 3.

- `notifications` has `project_id`, `task_id` and `case_id` (migration `0041`, inbox mutes, which also filled existing rows) and a `muted` flag (migration `0043`, muted notifications). `notify()` reads the three ids from the target: a task or evaluation gives its project and task, a slide its project and case with the task from the payload, a job its project, and a project itself. Threads and deliveries give nothing until COLLAB-002 (threads API) and REMOTE-003 (events out) add them, and a target that cannot be found gives nothing.
- `notification_mutes` holds one row per person and subject (`project`, `task` or `case` and its id). It is tenant-owned with row-level security and cascades from the membership.
- Every catalogue entry in `parfocal_api.notification_catalogue` declares `breaks_mute`, a keyword field without a default, and `BREAKS_MUTES` collects the kinds that set it. Today they are mentions, task assigned, task due soon and emergency access. The catalogue has no reassign or nudge kind yet, and one added later declares the flag like every other kind. Disagreements ready, task signed off, model runs, uploads, results added, replies and integration down stay muted, because they report what others or the system did rather than hand the person work.
- For a recipient who muted the notification's project, task or case, and a kind outside `BREAKS_MUTES`, `notify()` stores the row with `muted` set, `realtime` off and no email. The in-app choice of the person's preferences still applies.
- Muting also marks that person's pending emails for the same subject as skipped, except for kinds in `BREAKS_MUTES`, so a digest or quiet-hours hold does not send them later. Rows that arrived before the mute keep their flag and stay in the main list.
- Unmuting sends nothing that was muted. Muted rows keep their flag and stay in the inbox under the muted filter.
- `PUT /api/me/notification-mutes/{subject}/{id}` mutes and `DELETE` unmutes, and both answer the person's mutes. A person can mute only what they can read: a project they hold a role in or reach through emergency access, a task they read, or a case with slides they read. Anything else is 404 `mute-subject-not-found`. `GET /api/me/notification-mutes` lists them.
- The inbox (`GET /api/me/notifications`) lists the person's in-app notifications filtered by kinds, read state and `muted`, in keyset pages like My work. `muted` is false by default, so the bell and the main list show only unmuted items, and `muted=true` shows the muted ones. Each item has the kind, a `/go/{id}` link, the target type and id, the payload, the three context ids, the muted flag, the read time and the creation time. The target itself is still resolved on open through `GET /api/me/notifications/{id}/target`, as ADR 0091 decided, so a page needs no permission check per row.
- `GET /api/me/notifications/counts` gives the total and unread count per kind over unmuted rows, for the bell's badge and tabs, and reports `muted` and `muted_unread` apart. `POST /api/me/notifications/read` marks the given ids, or all of them with optional kinds and an `up_to` time, muted rows included, and changes only the caller's unread rows.

## Consequences

- Nothing is thrown away, and per-kind preferences still decide the channels of everything that is not muted.
- A new catalogue kind must say whether it breaks through a mute, and `test_every_kind_declares_whether_it_breaks_through_a_mute` pins the current set.
- COLLAB-002 (threads API) must give mentions and replies their project, task and case when it resolves thread targets, or a mute will not catch replies. A thread mute, if wanted, is a new subject kind there.
- NOTIF-002 (the bell) groups kinds into For me, Mentions and Jobs on the client from the counts and the `kind` filter, and its badge uses the unmuted unread count. NOTIF-008 (hold notifications while reading) holds pushes, and muted rows have none.
- SET-008 (notifications section) can show and remove mutes with the list route.
- The data map, the permission page and the tenant isolation suite cover the new columns, routes and table.
