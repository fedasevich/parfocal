# 0385. Webhook imports are credited to the person who made the secret, and the call names a Parfocal case

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: REMOTE-002 (webhook in per project)

## Context

[ADR 0379](0379-remote-sources-read-in-place-signed-webhooks-and-at-least-once-events.md) (remote sources read in place, signed webhooks and at least once events) fixed how a webhook call is signed. Building it raised three choices it left open.

Every upload row must name who created it, a person or a service account (the `ck_uploads_created_by` check). A webhook call has neither, because it proves only that it holds the project secret.

The request and answer bodies are now a contract that lab pipelines will code against, so changing them later breaks scripts we do not control.

The task asks for "a case ID" and optionally a task. Slides join a task through `review_task_slides`, which needs the slide and, for review tasks, its result set, and neither exists until the fetch and ingest jobs end.

## Decision

1. Uploads started by a webhook call are credited to the person who last made the project's webhook secret. Making a new secret moves the credit to the new maker. The audit event names the system as the actor and the webhook as the target, so the log still shows that a pipeline, not the person, made the call. If that person's account is gone the call is refused with `webhook-owner-gone` until an admin makes a new secret.
2. The body is `{"slide": link, "results": [links], "case_id": uuid, "task_id": uuid or absent}`. Unknown fields are refused. `case_id` is the Parfocal case UUID in the project, not the case label, so a call never creates a case and never matches a label by accident.
3. The answer (202) holds `call_id`, `project_id`, `case_id`, `repeated`, a `task` object and one outcome per link (`started` with its upload and job IDs, or `refused` with a plain message). Links in the answer and the audit log lose their query string and user part.
4. A named task is checked to belong to the project. The call stores the task beside the slide upload and answers `waiting`. When ingest finishes, the slide joins the task: an annotate task takes it when the slide is published, and a review task takes it when its first result set is imported, because a review task slide needs a result set. The new slide goes to every reviewer of the task when it is split to everyone, and otherwise to the reviewer with the fewest slides. Each attachment is audited as `webhook.task-attached`. A review task named without a result file, or a slide that was not imported, is answered `not-attached` with the reason.
5. A slide already in the case, matched by label and size as the link import does, is left out with its results.
6. Bad signatures are audited as `webhook.rejected`, every other call as `webhook.called`, which are the names the admin audit screen already shows.

## Alternatives

- A service account per webhook would credit imports to a machine identity, but it adds a second identity to rotate and show, and service accounts are not built per project.
- Relaxing the check to allow uploads with no creator would be simplest, but every place that lists "my uploads" or resumes an upload would need a third case.
- Taking a case label and creating the case when missing suits pipelines that know only their own IDs, but a typo would create a stray case. It can be added later as a separate field.
- Attaching at call time is impossible, because the slide and its result set do not exist until ingest ends.

## Consequences

- If the secret maker leaves, webhook imports stop with a clear error until someone makes a new secret.
- ADMIN-006 (storage, sources, API and webhooks) shows who the imports are credited to next to the secret.
