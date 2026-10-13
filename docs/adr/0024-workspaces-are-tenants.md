# 0024. Each workspace is a tenant, organisations group them, and platform operators manage both

- Date: 2026-10-13
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: IAM-003, IAM-004, IAM-005, IAM-008, IAM-002, IAM-006

## Context

IAM-003 says an organisation can hold several workspaces, such as diagnostic, research de-identified and a second-opinion network. [ADR 0018](0018-postgres-sqlalchemy-rls.md) and [ADR 0020](0020-authorization-rls-scopes-and-rbac.md) isolate data by one `tenant_id` per row with row-level security. Before the first tenant-owned table exists, it must be settled which of the two the `tenant_id` names, who may create and suspend tenants, and how the API finds out who is calling while login (IAM-002) still waits for Zitadel. The owner asked for the option that is best for the app and not too complicated.

## Options considered

1. Each workspace is a tenant, and an organisation only groups workspaces. Every table keeps one setting and one policy. A research workspace can never see diagnostic patient data, and erasing or moving a workspace is erasing or moving one tenant. Sharing across one organisation's workspaces needs an explicit copy or grant later.
2. Each organisation is a tenant, and workspaces are a second column with a second policy on every table. Sharing inside an organisation is easier, but every table, index, cache key and test needs both levels, and a missing workspace filter leaks diagnostic data into research.
3. A schema or database per workspace. Already ruled out in [ADR 0003](0003-pilot-platform-architecture.md).

## Decision

Option 1. It keeps the isolation rule as simple as it is today and makes the research and diagnostic split a hard wall rather than a filter.

- `organisations` holds slug and name. `tenants` holds organisation, slug, name, kind (`diagnostic`, `research`, `second-opinion`), region (`eu`, `us`), plan (`pilot` only until pricing exists) and status (`active`, `suspended`). Slugs are unique across all tenants.
- Platform operators create organisations and tenants and suspend or reactivate tenants through `/api/platform/*`. They have no tenant, so they cannot read tenant data, which matches the rule that administrators reach patient data only through emergency access (IAM-017).
- Both tables have forced row-level security too. A member sees only their own tenant and its organisation, and only a platform scope (`app.platform = 'on'`, set by the same request-context function as the tenant) may write. A catalog test fails when any table lacks forced row-level security.
- A request is refused with `tenant-suspended` when its tenant is suspended. The check runs inside the request's transaction, after the scope is set.
- Until IAM-002, `authenticate` refuses every request. IAM-002 replaces it with the session lookup and must return a member, guest or platform operator principal. How an operator is recognised (a Zitadel role or a separate operator login) is a TODO for IAM-002 and IAM-006.

## Consequences

- A person who works in two workspaces of one organisation has two memberships (IAM-005), and the workspace switcher (IAM-008) switches tenants.
- Anything shared across an organisation's workspaces, such as SSO (IAM-012) and organisation admins, hangs off `organisations` rather than `tenant_id`.
- Moving a case from diagnostic to research is a de-identified copy into another tenant, not a flag. TODO when a research task needs it.
- IAM-002, IAM-005 and IAM-006 were edited to match.
