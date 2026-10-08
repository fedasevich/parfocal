# 0020. Authorization: tenant row-level security, restrictive guest scopes and role permissions in code

- Date: 2026-10-08
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-023, IAM-004, IAM-006, IAM-010, COLLAB tasks that share threads

## Context

Parfocal needs hard tenant isolation, roles inside a tenant (org admin to read-only clinician, IAM-006), and guest consultants from another organisation who may read one case, optionally one view and its threads, and post only there (IAM-010, kit Flow 3, mock 11). [ADR 0018](0018-postgres-sqlalchemy-rls.md) already sets the tenant per transaction for row-level security.

## Options considered

1. Row-level security for tenants, plus a permission table for roles checked in the API. Guests handled by a grant row and a restrictive scope policy. Everything lives in Postgres and Python, with no extra service.
2. OpenFGA or SpiceDB for relationship-based access (Zanzibar style). Expressive for sharing graphs, but a separate service to run, keep consistent with Postgres and secure, and it does not replace row-level security as the floor.
3. Cerbos or OPA for policy evaluation. Good for attribute rules across services, but adds a service and a policy language for rules that are simple today.

## Decision

Option 1.

- **Tenant floor.** Every tenant-owned table keeps the `tenant_isolation` policy from ADR 0018.
- **Guest scope.** A `guest_grants` table in the host tenant records host tenant, case, optional view, guest user, permissions (`read`, `comment`), expiry and revocation. For a guest request the API loads an active grant and sets `app.tenant_id` to the host tenant and `app.scope_case_id` and `app.scope_view_id` from the grant, all in the transaction's first statement. Every table a guest could reach carries a `RESTRICTIVE` `guest_scope` policy. Tables that guests must never see, such as patients, are visible only when no scope is set.
- **One entry point.** Only the request-context function that turns an authenticated principal into database settings may call `set_config`. A guest principal cannot be turned into settings without its scope.
- **Roles.** Roles and their permissions are a table in code (IAM-006), checked by a FastAPI dependency on each endpoint before any query. Guests carry only the grant's permissions.
- **No relationship service now.** OpenFGA is reconsidered only if sharing grows beyond one case per grant, such as folders or cross-organisation teams.

Evidence is in [results/2026-10-08-guest-scope-rls-spike.md](../results/2026-10-08-guest-scope-rls-spike.md).

## Test plan

| Test | Level | Task |
|---|---|---|
| Every table with `tenant_id` has forced row-level security and `tenant_isolation` (already `test_every_tenant_table_is_isolated_at_head`) | migration | FOUND-013 |
| Every table a guest can reach has `guest_scope`, and patient tables hide all rows under any scope, checked from the catalog | migration | IAM-010 |
| Every list and get endpoint, called as a tenant B member against tenant A data, returns nothing | API, table-driven over the OpenAPI schema | IAM-004 |
| Every endpoint's permission for every role | API, table-driven | IAM-006 |
| A guest of case X, view V reads X and V, cannot read other cases, other views, patients or the worklist, posts in V's threads only, and is refused in other threads | API through the pooler | IAM-010 |
| An expired or revoked grant is refused, and revocation takes effect within one minute | API | IAM-010 |
| Building database settings for a guest principal without a grant fails | unit | IAM-004 |
| Settings never linger into the next transaction on the same pooled connection | database | IAM-004 |

## Consequences

- The scope settings join the tenant in the request context, and all of them use the `NULLIF(..., '')` pattern.
- Each new table that guests may reach needs its `guest_scope` policy in the same migration. The catalog test catches a missing one.
- Guest visibility of demographics stays open until IAM-010 decides it.
