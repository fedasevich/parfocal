# 0382. Events out lease their own outbox rows, and there are four events

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: REMOTE-003 (events out)

## Context

[ADR 0379](0379-remote-sources-read-in-place-signed-webhooks-and-at-least-once-events.md) (remote sources, signed webhooks and at-least-once events) decided that events go through an `event_outbox` table written in the caller's transaction, are signed with HMAC SHA-256 and are retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours. It left open how the delivery job holds its work, and its event list named `result-set-signed` and `result-set-retried`.

Two facts settle both points. The job queue of [ADR 0044](0044-background-jobs-and-workflows.md) (background jobs and workflows) has no delayed start and fails a job after a fixed number of tries, so it cannot express hours-long waits per event. Nothing in Parfocal signs or retries a result set. The backlog line says Parfocal calls a pipeline when a result set is added, and that the calls are signed, retried and logged.

## Options considered

1. Put each event in the job queue as its own job. This reuses the claim code, but the waits would need a new delayed start and a different try limit in a shared table that every worker reads.
2. Let each outbox row carry its own `status`, `attempts`, `next_attempt_at` and `lease_until`. A sweep claims due rows with `FOR UPDATE SKIP LOCKED` under the platform scope, then sends each one in its workspace scope and records the answer.

## Decision

Option 2.

- Tables (migration `0129`, after `0128`). `event_targets` holds one address per row for a project, the subscribed kinds, the secret sealed with the workspace data key, a count of events lost in a row, and a pause time. `event_outbox` holds one row per event and target, with an identity `sequence` and the stable `Parfocal-Event-Id`. `event_attempts` logs the outcome, the status code and the duration of every call. The outbox has the workspace policy plus a `platform_claims` policy like `jobs`, so one sweep can find due rows in every workspace.
- There are four events. `review-submitted` fires when a reviewer submits a slide. `task-disagreements` fires when that submission leaves every reviewer submitted and the queue has open disagreements. `task-signed-off` fires on sign-off. `result-set-added` fires when a result set becomes ready. The `result-set-signed` and `result-set-retried` events of ADR 0379 (signed webhooks and at-least-once events) are dropped because nothing fires them. The words "signed, retried and logged" describe the delivery.
- Bodies carry only IDs, the kind, the sequence and the time. Reviewer IDs are left out because of blinding.
- The signature is `v1=` and the hex HMAC of `timestamp.body`, sent in `Parfocal-Timestamp` and `Parfocal-Signature`. The helper lives in `parfocal_common.webhook_signing`, so REMOTE-002 (webhook in per project) can verify with the same function. Each attempt gets a fresh timestamp over the same bytes.
- After a lost event (six calls with no 2xx answer), the target's count goes up. At five lost events in a row the target is paused, an audit event is written, and workspace admins get an `integration-down` notification whose target is the lost event. The resolver opens it for people who hold the integrations permission. Replaying a failed event clears the pause.
- The sweep is `python -m parfocal_api.event_delivery`, and it runs one pass. Scheduling it in production is left to a follow-up.

## Consequences

- Five operations, all under the integrations permission: `listEventTargets`, `saveEventTarget` (shows the secret once), `deleteEventTarget`, `listEventDeliveries` and `replayEvent`. Rotating the secret and the admin screen belong to ADMIN-006 (storage, sources, API and webhooks).
- Until the sweep is scheduled, events wait in the outbox. Nothing is lost, because rows stay pending.
- A paused target gets no new events. Pending events for it wait 12 hours between checks.
