# 0236. A read-only report link is a hashed random token that shows only the numbers, lasts 30 days and logs every opening

- Date: 2026-11-04
- Status: Proposed
- Deciders: Yurii Fedas (standing approval), proposed by the agent building EVAL-005 (read-only link for co-authors)
- Backlog: EVAL-005 (read-only link for co-authors), touches EVAL-002 (evaluation report page) and IAM-010 (guest consultant links, an idea)

## Context

EVAL-005 asks for a link to the evaluation report without slides, revocable and logged, so a co-author without an account can read the numbers. [ADR 0060](0060-no-sign-out-permissions-or-guest-scope.md) removed the guest principal and its row scope, because a report without slides needs none. Whoever holds the link reads it without signing in, so the token format, its lifetime and what the reader may see are hard to change once links are out in emails and drafts.

## Options considered

1. A signed token (HMAC over task and expiry). It needs no table, but it cannot be revoked one by one or counted without a table anyway.
2. A random token stored only as its SHA-256 hash in a `report_links` table, the way invitations and API tokens are stored. Revoking sets `revoked_at`, and the row counts openings.
3. A guest account invited to the project. It shows far more than the report and brings back the guest scope that ADR 0060 removed.

For the content: the whole `Evaluation` the owner sees, or a reduced copy without reviewer ids, preset use, display settings and free text opinion answers.

## Decision

Option 2. `POST /api/review-tasks/{id}/evaluation/links` makes a 256 bit `secrets.token_urlsafe(32)` token, returns it once with the URL `/shared-reports/{token}`, and stores its hash. Only the project owner creates, lists and revokes links (workspace permission create cases, project role owner). A link lasts 30 days, and the owner makes a new one when it runs out.

`GET /api/shared-reports/{token}` needs no sign-in. It finds the workspace through the auth scope, then reads in that workspace's scope. It returns the project name, the task name, the expiry and a `SharedEvaluation`: the decision counts, per class metrics, Dice, kappa with reviewers named Reviewer A, B and so on, agreement rates, reason codes and opinion counts and means. It leaves out the task, slide, result set and person ids, the preset use, the display settings and the free text opinion answers, because free text may hold anything a reviewer typed. No slide, image, label, patient or case field is reachable. A revoked or expired link answers 410 `report-link-gone`, an unknown token or a suspended workspace 404.

The audit log records `report-link.created` and `report-link.revoked` with the owner as actor, and every opening as `report-link.opened` with the `system` actor kind, the task id and whether it was refused. The reader is anonymous, so a new actor kind would carry no identity. The link row keeps `opened_count` and `last_opened_at` for the owner's list.

## Consequences

- A link can be revoked at once and every opening shows in the audit log, also openings after revocation.
- The reduced report is a second response model that must follow `Evaluation` when it grows. A new field is hidden from the link until it is added to `SharedEvaluation` on purpose.
- The public route counts openings per link in the same `rate_counters` table the per principal limiter uses, under the key `report-link:{link id}`, and answers 429 `rate-limited` with `Retry-After` past `rate_limit_report_link_per_minute` (60 by default). It needs no migration. A refused opening is not written to the audit log, so a flood of fetches cannot flood the log. An unknown token is not counted, because a 256 bit token cannot be guessed. EVAL-012 (share a report link from the report page) added this.
- EVAL-012 also built the owner's Share dialog on the report page and the public page at `/shared-reports/{token}`, which loads without sign-in and asks no other API.
