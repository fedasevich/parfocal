# 0055. Availability is available or away, with an optional end and note, and no back-up

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: ADAPT-009 (rework availability), supersedes [ADR 0051](0051-availability-status-and-back-up.md) for IAM-015 (availability status and back-up)

## Context

[ADR 0051](0051-availability-status-and-back-up.md) gave each membership a status of available, busy for up to 24 hours, or away with a named back-up, and new cases for an away person went to that back-up. Since [ADR 0053](0053-ai-results-review-direction.md) nothing routes cases. Researchers pick reviewers in a review task, and the picker should show who is away so the researcher can choose someone else. Busy only served short interruptions such as a tumor board, which is an idea now.

## Options considered

1. Remove the status altogether. It is the least code, but a researcher could then send a task to someone on leave without knowing it.
2. Keep available and away, with an optional end and an optional note, on the membership. The picker can show "Away until 3 November, at a conference", and nobody has to name a back-up.
3. Keep ADR 0051 as it is. Busy and the back-up would stay with nothing reading them.

## Decision

Option 2. `memberships` keeps `availability` (`available` or `away`) and `available_again_at`, adds `availability_note` (up to 200 characters, personal data) and drops `backup_user_id` with its key and checks. A check constraint allows an end or a note only when away. An end that has passed reads as available, so nothing runs on a timer. Migration `0019` is edited in place ([ADR 0054](0054-hospital-code-inventory-and-revert-order.md)).

## Consequences

- `PUT /api/me/availability` takes `status`, an optional `until` and an optional `note`. `GET /api/me/availability` and `GET /api/tenant/availability` return the same fields. Busy is refused as an unknown status.
- Case creation no longer swaps an away assignee for a back-up, and its audit entry lost `covered_by_backup`.
- The reviewer picker in TASK-005 (new review task stepper) shows the status. SHELL-012 (account menu) sets it.
- `tests/workspace_support.py` now holds the helpers that make a workspace with people, so tests no longer need folders to get one.
