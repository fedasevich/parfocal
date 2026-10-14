# 0029. Service accounts per workspace with our own hashed API tokens and narrow scopes

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: IAM-011, IAM-014, CASES-001, INGEST-001

## Context

IAM-011 asks for service accounts and API tokens for integrations such as the LIS adapter and import scripts, with scopes and rotation, tested for scope enforcement and revocation. People sign in through Zitadel behind the backend-for-frontend with sessions in Postgres ([ADR 0025](0025-zitadel-bff-login.md)). Permissions are the UX kit's matrix in code ([ADR 0026](0026-roles-and-permission-matrix.md)), where administrators hold "Integrations and upload sources" and leads may only view it. Agents may not grant Zitadel permissions on their own.

## Options considered

1. Zitadel machine users with client credentials or private-key JWTs. Standard OAuth, and Zitadel handles key rotation. But each workspace's integrations would need IdP objects managed from our API, the API would have to validate a second kind of token, revocation would depend on token lifetime or introspection calls, and creating machine users needs IdP permissions we do not hand out.
2. Our own opaque tokens. A random token shown once, stored as a SHA-256 hash in a tenant-owned table, checked on every request. Revocation is a row update that holds from the next request, the token lives inside one workspace's row-level security, and nothing outside our database is involved. SHA-256 without a slow hash is enough because the token has 256 bits of randomness.

For scopes, either a service account takes a role from the matrix or it holds an explicit list of permissions. A role would hand an integration everything a consultant or lab member can do, including signing out reports. A short list is easier to review.

## Decision

Option 2, with explicit scopes.

- A service account belongs to one workspace, has a unique name and one or more scopes from a fixed list: `see-cases`, `edit-cases`, `upload-slides` and `see-team`. Reports, sign-out, people, audit and integrations can never be granted, so a token cannot mint tokens.
- Tokens look like `pf_` followed by 43 random characters, are shown once at creation, expire after 90 days by default and at most 365, and record when they were last used, at most once a minute. Rotation issues a new token while the old one still works, then revokes the old one. Disabling an account stops all its tokens.
- Clients send `Authorization: Bearer pf_...`. A request with that header never falls back to the session cookie. The token becomes a `ServicePrincipal` with the workspace's database scope. `require()` grants a permission to a service principal only when it is in its scopes, and the person routes (`/api/me`, `/api/auth/session`) refuse it.
- Administrators create, rotate, revoke and disable through `/api/tenant/service-accounts`, and leads may list. Write routes declare `require(..., write=True)`, which refuses a view-only grant. Every step is audited ([ADR 0027](0027-audit-log-hash-chain-in-postgres.md)), and actions taken by a service are recorded with the `service` actor kind and the account id.

## Consequences

- An integration can be cut off immediately, and a token from one workspace cannot reach another.
- Each token check is a database read in the auth scope. TODO: measure once the LIS adapter (INTEGRATIONS) puts real load on it.
- The scope list grows with the features. Adding a scope changes the `ServiceScope` enum and the database check in a migration, and needs a line in this ADR's successor if it reaches clinical sign-off or people.
- IAM-014's admin console shows these routes. TODO: rate limits per token belong to SEC-012.
