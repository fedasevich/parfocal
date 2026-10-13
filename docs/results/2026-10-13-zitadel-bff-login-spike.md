# Result: Zitadel Cloud login through a FastAPI backend-for-frontend

- Date: 2026-10-13
- Backlog: STACK-028
- Kind: spike
- Commit: 02eae2b plus the uncommitted IAM-003 and IAM-004 work (the spike code ran from a scratch folder outside the repository)
- Environment: MacBook with Apple M4, macOS 15.8.1, Google Chrome 155.0.8059.40 headless through Playwright for Python. The network location of this machine was not recorded. Zitadel Cloud instance `parfocal-iqcyh5.eu1.zitadel.cloud` (EU, free plan), app `parfocal-api-dev` (confidential web app, basic client auth, JWT access tokens, dev mode for the `http://localhost:5173` redirect)
- Data: the test user `e2e-pathologist@parfocal.eu`, created for this spike through the v2 user API with a verified email and a password kept only in `.env`. No PHI

## Question

Can FastAPI run the OIDC code flow with PKCE as a confidential client so that the browser holds only an HttpOnly session cookie, refresh tokens server-side without the page noticing, log out at the IdP, and see which Zitadel organisation a user belongs to? Which cookie settings survive the redirects?

## Method

1. A scratch FastAPI app on port 5173 served `/api/auth/login`, `/api/auth/callback`, `/api/me`, `/api/auth/logout` and a catch-all page. Login stored the PKCE verifier, nonce, return path and a random binding value in memory under the `state`, set the binding in a `__Host-parfocal_login` cookie (10 minutes) and redirected to the authorize endpoint with scopes `openid profile email offline_access urn:zitadel:iam:user:resourceowner`.
2. The callback checked the binding cookie, exchanged the code with HTTP basic client auth and the verifier, verified the ID token with PyJWT against the discovered JWKS (issuer, audience, expiry, nonce) and created a server-side session with the tokens. It set `__Host-parfocal_session` (HttpOnly, Secure, SameSite=Strict) and sent the browser to the return path, either with a 302 or with a tiny HTML page holding a meta refresh.
3. `/api/me` refreshed the tokens with the refresh token whenever the access token was within 30 seconds of expiry. A test route set the expiry to zero to force it.
4. Logout deleted the session, revoked the refresh token and redirected to `end_session` with `id_token_hint` and the post-logout redirect.
5. A Playwright script opened `/api/auth/login?return_to=/cases/S26-0001`, typed the user name and password into Zitadel's hosted login (v2 UI), and recorded where it landed, whether the server received the session cookie on each request, `/api/me` before and after the forced refresh, logout, and whether the old refresh tokens still worked. Runs were repeated with a 302 instead of the HTML page and with a Strict binding cookie.

## Results

| Check | Outcome |
|---|---|
| Hosted login steps | Login name page, password page, then back to the callback. No MFA prompt appeared for the test user |
| Login to landing on the deep link | 3.57 s, 4.56 s, 3.96 s, 4.05 s, 5.07 s over five runs |
| Code exchange from this machine | 93 ms, 127 ms, 104 ms |
| Refresh from this machine | 88 ms, 87 ms, 100 ms |
| Access token lifetime (`expires_in`) | 43,199 s (12 h) |
| Refresh token rotation | A new refresh token on every refresh |
| Reusing a rotated refresh token | 400 `invalid_request` |
| Using a refresh token after logout revocation | 400 `invalid_request` |
| `/api/me` after logout | 401 |
| Organisation in the ID token | `urn:zitadel:iam:user:resourceowner:id`, `:name` and `:primary_domain` present when the scope `urn:zitadel:iam:user:resourceowner` is asked for |

Cookie behaviour in Chrome 155:

| Variant | Binding cookie on the callback | Session cookie on the landing page |
|---|---|---|
| Lax binding cookie, HTML hop after the callback | Sent | Sent, also on reload |
| Lax binding cookie, 302 after the callback | Sent | Not sent, not even on reload |
| Strict binding cookie | Not sent, so the callback refused the login | No session |

## Interpretation

- The backend-for-frontend pattern works with Zitadel Cloud as configured by `infra/tofu`. The page never sees a token, and a refresh happens on the server in about 0.1 s.
- A Strict cookie set on a response to a cross-site navigation is not sent for the rest of that navigation chain. The login binding must therefore be Lax, which is safe because it carries only a random value that is useless without the server-side record. The session cookie can stay Strict if the callback answers with a same-site HTML hop rather than a redirect.
- With a 12 h access token, refreshes are rare, so they are a cheap way to notice a user who was deactivated or whose IdP session was revoked.
- Assumption: login time is dominated by the hosted login pages and typing in Playwright, not by the backend.

## Follow-ups

- [ADR 0025](../adr/0025-zitadel-bff-login.md) records the choice and the cookie rules.
- IAM-002 builds this into `apps/api` with sessions in Postgres.
- TODO: the Playwright E2E for IAM-002 needs the test user's password and the dev app's client secret as GitHub secrets before it can run in CI. That is the owner's call.
