# Result: A restrictive scope policy limits a guest to one case and one view

- Date: 2026-10-08
- Backlog: STACK-023
- Kind: spike
- Commit: 41bfe25 (SQL run against the local `compose.yaml` stack in a throwaway schema, reproduced in the method)
- Environment: MacBook with Apple M4, Docker Desktop, the repository's `compose.yaml` (PostgreSQL 17.10 with PostGIS 3.6.1, PgBouncer 1.26 in transaction mode). Queries ran as `parfocal_app` through the pooler with `psql`
- Data: two synthetic tenants, fake names, no PHI

## Question

Can a guest from organisation B read exactly one view of one case in organisation A, and post only in that view's threads, with row-level security as the hard limit rather than application checks alone?

## Method

A schema with `patients`, `cases`, `views` and `threads`, each with `tenant_id`, forced row-level security and the `tenant_isolation` policy from ADR 0018. On top, a `RESTRICTIVE` policy named `guest_scope` on each table reads two more per-transaction settings, `app.scope_case_id` and `app.scope_view_id`:

- `patients`: visible only when no case scope is set.
- `cases`: no scope, or `id` equals the scoped case.
- `views`: no scope, or the scoped case and, when a view scope is set, the scoped view.
- `threads`: the same rule as views for `USING` and `WITH CHECK`.

Tenant A had one patient, two cases, three views (two on case 1, one on case 2) and three threads, one per view. Tenant B had one patient and one case. Each scenario ran in its own transaction that set the settings with `set_config(..., true)`.

## Results

| Scenario | Settings | Result |
|---|---|---|
| Member of A | tenant A | patients 1, cases 2, views 3, threads 3 |
| Guest from B on case 1, shared view | tenant A, case 1, view 1 | patients 0, cases 1, views 1, threads 1 (`shared thread`) |
| Guest posts in the shared view | same | `INSERT 0 1` |
| Guest posts in the private view of the same case | same | `new row violates row-level security policy "guest_scope" for table "threads"` |
| Guest updates the thread of the other case | same | `UPDATE 0` |
| Guest in their own tenant B | tenant B | 0 cases of tenant A |
| Next transaction on the same connection | tenant A only | threads 4, so the scope did not linger |

## Interpretation

- Restrictive policies are combined with AND, so the scope can only narrow what tenant isolation already allows. A mistake in the scope can hide too much but cannot widen access beyond the host tenant.
- The guest runs in the host tenant's context. If the API set the tenant without the scope for a guest, the guest would see the whole host tenant. The scope therefore has to be set by the same function that sets the tenant, from the guest grant, and tests must cover it.
- The guest saw no patient row. Whether a guest consultant sees age and sex is a product question for IAM-010. TODO.

## Follow-ups

- [ADR 0020](../adr/0020-authorization-rls-scopes-and-rbac.md) records the model and the test plan.
