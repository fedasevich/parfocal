# XXXX. Evaluation versions are stored rows, and owner changes after sign-off need a reason

- Date: 2026-11-06
- Status: Proposed
- Deciders: Yurii Fedas (standing approval)
- Backlog: ADJ-004 (sign-off as a soft lock), builds on [ADR 0080](0080-disagreement-rule-and-sign-off.md) (disagreement rule and sign-off) and [ADR 0231](0231-evaluation-exports-and-their-checksum.md) (evaluation exports and their checksum), feeds ADJ-005 (changes after sign-off)

## Context

ADJ-004 makes sign-off create Evaluation v1 with a checksum, store the report's block list, notify reviewers, keep the owner able to change things with every change logged, allow reopening, and ask for a reason before v2. Until now sign-off only set `review_tasks.signed_off_at`, exports computed version 1 on every request, and every queue change after sign-off was refused.

## Options considered

Where versions live:

1. Columns on `review_tasks` for the current version. Loses earlier versions when v2 is signed.
2. One `evaluation_versions` row per version with the evaluation JSON, checksum, blocks and format as signed, and a draft row with its reason while the next version is open.

Owner changes after sign-off:

1. Keep refusing them until the owner reopens the task, as ADR 0072 (decisions, reasons and opinion forms) first said.
2. Let the owner decide or leave open a queued object on a signed task when the request gives a `reason`, and log each change in `evaluation_changes` and the audit entry.

## Decision

Option 2 in both cases.

- Signing writes or completes the version row with `sha256:` of the evaluation JSON (the ADR 0231 rule), the template's blocks and format, who signed and `confirmed_with` (`sso` or `password`). Exports of a signed task carry the stored version and checksum, and the PDF renders the stored blocks. Reviewers get a `task-signed-off` notification, and opening it takes a reviewer, who cannot see the evaluation, to the task.
- `POST /api/review-tasks/{id}/evaluation-versions` (`startEvaluationVersion`) and `POST /reopen` both need a reason of at least 10 characters. Both add the next draft version and lift the lock. Signing again signs that draft.
- After sign-off the owner may decide or leave open a queued object with a `reason`. Without one the answer is 409 `change-reason-needed`. Clearing a decision stays refused. Each change adds an `evaluation_changes` row with the version, object, change and reason, and the audit entry has `after_sign_off` and `evaluation_version`. Reviewers and adjudicators stay locked out.
- `GET /api/review-tasks/{id}/sign-off-summary` (`getSignOffSummary`) answers the sign-off modal. Its `signature` is the last signed version, and `next_version` is an open draft above it.

## Consequences

- ADJ-005 lists `evaluation_changes` in the report and can add more kinds of change.
- The single sign-on confirmation is still only recorded, not enforced. A real step-up through the identity provider (the existing `reauth` login with `prompt=login`) and the password fallback are TODO for a later task.
- Tasks signed before this change have no version row, so their exports keep the computed version 1.
