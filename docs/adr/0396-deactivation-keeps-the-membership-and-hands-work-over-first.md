# 0396. Deactivation keeps the membership row, hands open work over first and ends sessions at the end date

- Date: 2026-11-18
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-020

## Context

IAM-020 (deactivation with hand-over) lets an admin remove a person from a workspace without losing what they did. Decisions, sign-offs and audit events point at the user and at `(task, slide, user)` assignment rows, and a signed-off evaluation carries a checksum over those decisions. [ADR 0142](0142-reassign-releases-started-assignments.md) (a reassign releases started assignments) already says a started assignment stays under the first reviewer's name.

## Options considered

1. Delete the membership row. It breaks the foreign key from `review_assignments` and loses who the person was in the workspace.
2. Keep the row and add `deactivates_on` and `deactivated_at` to `memberships`. Sign-in, the workspace list and the session check ignore a deactivated row, and every history table keeps its reference.
3. Keep the row and flag the person in Zitadel only. Our own API would keep serving a session that is still alive.

## Decision

Option 2.

- Open work is four lists: review slides not yet submitted on an unfinished task, tasks the person created, adjudications with an object they have not decided, and threads they opened and nobody resolved.
- A deactivation is refused with 409 `open-work`, whose `current.items` lists what is left, until every item has a hand-over. A hand-over is `reassign` to a named active member or `return`. Return releases slides, leaves a task without a creator so the project owners hold it, declines an adjudication so it goes back to the queue, and resolves a thread. Threads cannot be reassigned, because that would rewrite who asked.
- Reassigning slides reuses the reassign rules of the Team screen (a started slide is released and keeps its work, the new reviewer must be an owner or reviewer of the project), and writes a `task_reassignments` row.
- With no end date the person is deactivated at once and their sessions in that workspace are deleted and their refresh tokens revoked. With a future end date the hand-overs happen now and the person keeps access until the date. `finish_due_deactivations(engine, today)` then returns whatever arrived since, sets `deactivated_at`, audits as the system and deletes the sessions. It takes the date as an argument so a test runs it on a fake clock. A scheduled deactivation can be cancelled before its date.
- The session check reads `deactivated_at` in its one statement and treats the row as no membership. Sign-in and the workspace list skip deactivated rows.
- An admin cannot deactivate themselves, and the last admin cannot be deactivated.

## Consequences

- Migration `0138` (member deactivation) adds the two columns to `memberships`.
- The sweep has no scheduler yet. `python -m parfocal_api.deactivation` runs it once, and the daily trigger belongs with the other maintenance jobs.
- Reactivation is not built. It would clear `deactivated_at`.
- A deactivated person's decisions still count in the evaluation, as [ADR 0142](0142-reassign-releases-started-assignments.md) left open for released reviewers.
