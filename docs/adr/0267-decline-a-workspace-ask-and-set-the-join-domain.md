# 0267. Decline a workspace ask by removing it, and set the join domain in Admin

- Date: 2026-11-09
- Status: Accepted
- Deciders: agent, for the owner to review
- Backlog: ONB-011 (answer workspace asks and set the join domain in Admin)

## Context

ADR 0265 (join a workspace by its verified email domain) left two gaps. An admin could approve an ask only through the API and could not decline it, and no screen changed a workspace's email domain, join policy or logo. The ask table allows only the statuses `pending` and `approved`, so a stored `declined` status would need a migration while another task was adding one in parallel. The `tenants` row is writable only by a platform operator under row-level security.

## Options considered

1. Decline removes the pending ask and writes a `workspace.access-declined` audit event. No migration. The person may ask again later, and the audit log keeps who declined which ask.
2. Add a `declined` status with a migration. The table keeps the history and could stop a person from asking again, but needs a schema change for a rule nobody has asked for yet.

For the settings, the domain, policy and logo could live in the JSON workspace settings, or stay on the `tenants` columns that ONB-010 (join or ask for a workspace) added and that the join flow already reads.

## Decision

Option 1. `DELETE /api/tenant/access-requests/{id}` (`declineWorkspaceAccessRequest`) needs the people right with write, removes only a pending ask of the current workspace and audits it.

`GET` and `PUT /api/tenant/join-settings` (`getJoinSettings`, `setJoinSettings`) read and set `email_domain`, `join_policy`, `logo` and `logo_colour` on the tenant, behind the workspace settings right. The write opens a platform-scoped transaction for the caller's own tenant, as creating a workspace does, and is audited as `tenant.join-settings-changed`. A domain is trimmed and lower-cased, must be a hostname, and is refused with `public-email-domain` when it is a public mail provider from the same list that keeps such domains off new workspaces. An empty domain hides the workspace from everyone.

An ask notification links straight to `/admin?section=people&request={id}`, where the Join requests list marks that ask.

## Consequences

- Declined asks leave no row, only an audit event. If the owner wants a declined person kept from asking again, a `declined` status is one additive migration.
- Any admin can set any non-public domain, including one that none of the workspace's people hold. Whether the domain must match an admin's verified email is an open question for the owner.
- Uploading an image logo still needs a column and storage and is left for later.
