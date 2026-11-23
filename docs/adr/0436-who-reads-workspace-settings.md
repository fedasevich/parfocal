# 0436. Admin rights gate every read that only the admin page makes

- Date: 2026-11-23
- Status: Accepted
- Deciders: Claude (from the PILOT-011 walk of the deployed app)
- Backlog: SEC-052 (the admin API and the Admin page agree on who may read workspace settings)

## Context

[ADR 0096](0096-researcher-and-reviewer-with-admin-rights.md) (researcher and reviewer with admin rights) gives every researcher view-only `workspace-settings` and `integrations`, and admin rights raise both to yes. [ADR 0266](0266-admin-sections-and-their-permissions.md) (admin sections and their permissions) keeps that view-only access on purpose, for screens such as the upload picker, but lets only a researcher with admin rights open the admin page.

The PILOT-011 walk (a numbered walkthrough of the deployed app, per role) found that the two rules disagree. The page refuses role-researcher, a researcher without admin rights, yet GET `/api/tenant/overview`, `/storage`, `/webhooks`, `/security` and `/retention` answer 200 to the same person. Webhook targets, service accounts, the join domain, security settings and lab model connections reach someone the page sends away, and the API is meant to be the guard, not the screen.

## Options considered

1. Change the matrix so a researcher gets no `workspace-settings` and no `integrations`. Simple, but it breaks the upload screen's saved sources and the KPI screen, which plain researchers use.
2. Hide the data in the page only. The API keeps leaking it to anyone who calls it.
3. Keep the matrix and mark each read that only the admin page makes as an admin read, which needs the full grant that only admin rights give, as a write does.

## Decision

Option 3. `require(permission, admin=True)` refuses a view-only grant with 403 and its usual audit event, and the OpenAPI operation carries `x-permission-admin`. These reads need admin rights: `getAdminOverview`, `getStorageUsage`, `getSecuritySettings`, `listWebhooks`, `listAiModels`, `getLabModelConnection`, `getLabModel`, `getProjectWebhook`, `listEventTargets`, `listEventDeliveries`, `getRetentionPolicy`, `listLegalHolds`, `getAiUsage`, `getJoinSettings`, `listServiceAccounts` and `getSecurityContact`.

Three reads stay view-only for a researcher because their own screens use them and they hold no setup secrets. `listImportSources` feeds the upload picker, as [ADR 0378](0378-saved-import-sources-keep-credentials-on-the-server.md) (saved import sources keep credentials on the server) says, and returns no credentials. `getAiCorrections` and `getTaskTiming` feed the KPI screen.

A new read guarded by `workspace-settings` or `integrations` must be one or the other, because the permission test lists both sets and fails on a read in neither.

## Consequences

- The matrix in `permissions.py` and the generated permission page do not change. The table-driven permission test expects 403 for a plain researcher on every admin read.
- `scripts/walkthrough` expects 403 for role-researcher on the admin reads, and a `@real` browser spec checks the page and the API together when the role account's credentials are set.
- ADR 0266's last paragraph now holds only for the three view-only reads above.
