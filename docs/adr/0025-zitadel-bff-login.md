# 0025. Zitadel Cloud behind a FastAPI backend-for-frontend with sessions in Postgres

- Date: 2026-10-13
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-028, IAM-002, IAM-005, IAM-009, IAM-012, IAM-019

## Context

[ADR 0003](0003-pilot-platform-architecture.md) picked Zitadel Cloud on the free plan as the default identity provider, with FastAPI as a confidential OIDC client and only an HttpOnly cookie in the browser. STACK-028 asks for a spike that logs in through the backend, refreshes server-side and maps IdP organisations to tenants. The instance, the project and one OIDC app per environment already exist as OpenTofu code. [ADR 0024](0024-workspaces-are-tenants.md) made each workspace a tenant and left open how a platform operator is recognised.

## Options considered

1. Identity provider. Zitadel Cloud (EU region, free tier, OIDC with PKCE, TOTP and WebAuthn, organisations and per-organisation IdPs for later SSO, already provisioned) against Keycloak (self-hosted, so an always-on service to run and patch), WorkOS, Auth0 and Clerk (strong SSO stories, but per-connection or per-user pricing and no EU-only hosting on low tiers). No new measurements were taken for the alternatives. The comparison is from ADR 0003's planning.
2. OIDC client code. Authlib 1.8 (full OAuth client, but its Starlette integration keeps login state in a signed cookie session and it brings `httpx` next to the `httpx2` the repository already uses) or a small client on `httpx2` and PyJWT 2.15 (about a hundred lines, which the spike proved, and every step is visible and testable).
3. Where sessions live. Signed cookies holding tokens (no server state, but tokens reach the browser and cannot be revoked) or random session ids in a cookie with the session and tokens in Postgres (revocable, auditable, needed for IAM-009's session list).
4. Platform operators. A Zitadel project role asserted in the token, or a `platform_operators` table in our database keyed by IdP subject and managed from a command-line tool.

## Decision

Zitadel Cloud, a small client on `httpx2` and PyJWT, sessions in Postgres, and platform operators in our database.

- Login uses the code flow with PKCE (S256), `state` and `nonce`, and HTTP basic client auth. The scopes are `openid profile email offline_access urn:zitadel:iam:user:resourceowner`. The ID token is verified against the discovered JWKS for issuer, audience, expiry and nonce.
- A pending login is stored server-side under a hash of `state`, and a `__Host-parfocal_login` cookie (HttpOnly, Secure, SameSite=Lax, 10 minutes) binds it to the browser. It must be Lax, because a Strict cookie is not sent on the redirect back from Zitadel.
- The session id is random, sent as `__Host-parfocal_session` (HttpOnly, Secure, SameSite=Strict, path `/`) and stored only as a hash. The callback answers with a same-site HTML page that moves to the return path, because after a 302 Chrome does not send the Strict cookie on the landing page.
- The refresh token is kept encrypted with AES-GCM under a key from the API settings until SEC-004 brings envelope encryption. The access token is refreshed server-side when it expires, and a failed refresh ends the session. Logout revokes the refresh token, deletes the session and redirects to Zitadel's `end_session`.
- The return path must be a same-origin path starting with a single `/`, so login cannot be used as an open redirect.
- Our database stays the source of truth for organisations, memberships and roles, as the planning baseline says. Every user lives in Zitadel's `Parfocal` organisation until per-organisation SSO (IAM-012). Then an organisation row gains the Zitadel organisation id, and the `urn:zitadel:iam:user:resourceowner:id` claim picks the organisation for just-in-time provisioning. The spike showed the claim is present.
- A platform operator is a row in `platform_operators`. Operators are added and removed from a command-line tool, never through the API.

Evidence is in [results/2026-10-13-zitadel-bff-login-spike.md](../results/2026-10-13-zitadel-bff-login-spike.md).

## Consequences

- IAM-002 builds the tables `auth_logins`, `sessions` and `platform_operators`, all under forced row-level security with an auth-only scope, since sessions belong to no tenant.
- Until IAM-005 links users to tenants, a signed-in user has no tenant, so tenant routes still refuse them.
- The API settings gain a session encryption key. Losing it signs everyone out, and nothing else.
- E2E tests need the test user's password and the dev app's secret in CI. Adding them as GitHub secrets is the owner's step.
- IAM-002 was edited to name these rules.
