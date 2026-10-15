# 0051. Availability status per workspace, with an away person's new cases going to their back-up

- Date: 2026-10-15
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: IAM-015 (availability status and back-up), CASES-011 (case assignment and routing), CASES-022 (assignment rules), BOARD-007 (reassigning), NOTIF-003 (STAT notifications), SHELL-012 (account menu)

## Context

[ADR 0021](0021-chosen-home-worklist-status-board-and-account-menu.md) puts a status in the account menu: available, busy, or away with a back-up. The reassign picker shows it, routing must respect it and STAT notifications must reach someone who can act. A person can belong to several workspaces and may be away in one and working in another.

## Options considered

1. Store the status on the user. It is simple, but a back-up must be a member of the same workspace, and the status could not differ between workspaces.
2. Store the status on the membership. The back-up becomes a key inside the workspace, and each workspace sees only its own people.
3. Keep a history table of status periods. It allows planned absences, but nothing in the kit plans absences yet.

For new cases meant for someone who is away, the choice was between refusing the assignment, keeping it, or giving it to the back-up.

## Decision

Option 2. `memberships` holds `availability` (`available`, `busy` or `away`), `available_again_at` and `backup_user_id` (migration `0019`). A check constraint keeps the combinations valid: busy needs an end, away needs a back-up, and available has neither. The back-up key includes the workspace, so it cannot point into another workspace.

- Busy lasts at most 24 hours and has no back-up. A busy person keeps new cases, because busy is short, such as a tumor board.
- Away needs a back-up and may have an end. A new case assigned to an away person, by hand or by a rule, goes to the back-up, and the audit entry records `covered_by_backup`.
- The back-up must be another member of the workspace who is not away, so chains of back-ups never form.
- A status whose end has passed reads as available. Nothing has to run on a timer.

The routing rules in `parfocal_api.routing` take a preferred person per case. If that person is unavailable with a back-up, the back-up is preferred, and if neither can take the case the usual least-loaded choice applies.

## Consequences

`GET` and `PUT /api/me/availability` read and set one's own status, and `GET /api/tenant/availability` lists the team for the reassign picker (needs "see the team"). BOARD-007 (reassigning) and NOTIF-003 (STAT notifications) read the same status. SHELL-012 (account menu) builds the screen. Planned absences would need option 3 later. A back-up who goes away after being named does not move the first person's cases on. TODO: CASES-022 (assignment rules) should handle this when it routes.
