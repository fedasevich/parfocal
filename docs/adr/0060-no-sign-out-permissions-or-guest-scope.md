# 0060. The sign-out permissions, the outside consultant and the guest scope are removed

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: ADAPT-001 (remove hospital-only permissions, grants and the guest scope), touches IAM-006 (roles and permission matrix), IAM-004 (tenant context) and IAM-010 (guest consultant links, an idea)

## Context

The matrix of [ADR 0026](0026-roles-and-permission-matrix.md) had 26 permissions, six roles and ten grants. [ADR 0054](0054-hospital-code-inventory-and-revert-order.md) marked 13 permissions and four grants as serving only sign-out, second opinions, tumor boards and model approval, which [ADR 0053](0053-ai-results-review-direction.md) made ideas. The outside consultant column came with a guest principal, a case and view setting in `DatabaseScope` and two restrictive policies (`guest_case_scope` on the case tables, `guest_hidden` on `patients`). Nothing ever created a guest principal, because guest links (IAM-010) were never built.

## Options considered

1. Keep the guest scope for a future share link. EVAL-005 (read-only link for co-authors) shares a report without slides, so it needs no row scope, and keeping the policies would leave dead checks on every case query.
2. Remove the guest scope with the outside consultant. A future guest link can bring back a restrictive policy, as [knowledge/database.md](../knowledge/database.md) explains.

## Decision

Option 2. These permissions are gone: cancel, take and reassign cases, order lab work, draft, sign out, co-sign and amend reports, ask for and give a second opinion, share reports, tumor boards and approve models. The grants needs co-sign, as named supervisor, shared with them and measure and comment are gone, which leaves Yes, assigned to them, view only, emergency with reason, and no. The matrix has five columns, the five membership roles, so `MEMBER_ROLES` and the outside consultant validator went too.

`GuestPrincipal`, `GuestGrant`, `MissingGuestGrantError`, `ActorKind.GUEST`, `DatabaseScope.case_id` and `view_id`, the `app.scope_case_id` and `app.scope_view_id` settings, `enable_guest_case_scope`, `hide_from_guests` and both policies were removed. Migrations `0006`, `0007` and `0012` were edited in place, so the audit actor kind check no longer allows `guest`.

## Consequences

- A case response always carries the patient for a principal who may see it, because no principal sees a case without the patient any more.
- The permission doc, the OpenAPI client and the data map were regenerated.
- IAM-022 (researcher, reviewer and admin roles) replaces the five remaining roles and renames the kept permissions. It writes the ADR that supersedes ADR 0026.
- TASK-007 (nudge, reassign and change a task), ADJ-004 (sign-off as a soft lock) and JOBS-005 (connect a lab model) add their own permissions when they are built.
