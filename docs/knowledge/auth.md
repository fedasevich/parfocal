# Sign-in and sessions

How login through Zitadel works in `apps/api` and the traps found while building it, as decided in [ADR 0025](../adr/0025-zitadel-bff-login.md).

## A Strict cookie is not sent after a cross-site redirect

When Zitadel redirects the browser back to `/api/auth/callback`, the whole navigation counts as cross-site. A SameSite=Strict cookie set on that response is not sent on a following 302 to the app, and in Chrome 155 not even when the user reloads that page. The login binding cookie is therefore Lax, and the callback answers with a small HTML page whose meta refresh starts a new same-site navigation, after which the Strict session cookie is sent. A Strict binding cookie made every callback fail. Source: [STACK-028 spike](../results/2026-10-13-zitadel-bff-login-spike.md).

## Zitadel rotates refresh tokens

Every refresh returns a new refresh token, and the old one then fails with 400 `invalid_request`, as does a revoked one. `authenticate` locks the session row with `FOR UPDATE` while it refreshes, so two requests at the same moment cannot both spend the same token and end the session.

## After logout Zitadel remembers the account

The next login shows an account picker with the previous user. Choosing it asks for the password again, which is what proves the IdP session ended. The E2E test checks the password field, not the login name field.

## Where things live

| Item | Where |
|---|---|
| Login, callback, logout, session | `/api/auth/login`, `/callback` and `/logout` are browser navigations and are left out of the OpenAPI schema. `/api/auth/session` (`getSession`) is a normal call |
| Tables | `auth_logins` (pending logins by hash of `state`), `sessions` (by hash of the cookie value, tokens and profile sealed with AES-GCM under `SESSION_KEY`), `platform_operators`, all readable only in the auth scope |
| Session lifetime | The active workspace's `session_policies` row, 12 h and a 15 minute idle lock by default. `last_seen_at` follows any request at most once a minute, but only `POST /api/auth/activity` and login move `active_at`, which the idle lock reads |
| Platform operators | `uv run --package parfocal-api --env-file .env python -m parfocal_api.operators add <zitadel-user-id>`, also `remove` and `list` |
| Test user | `e2e-pathologist@parfocal.eu` in Zitadel's `Parfocal` organisation, password in `.env` as `ZITADEL_TEST_PASSWORD`, MFA not set up |

Login creates the `users` row on first sign-in and later only refreshes its email, which it stores only when the ID token says `email_verified` is true, so a profile edited in the app is never overwritten by the IdP. The session's `active_tenant_id` starts at the user's last workspace if they are still a member, or their only workspace, and `PUT /api/me/workspace` changes it. `authenticate` returns a `MemberPrincipal` only while the membership exists.

`SESSION_KEY` is 32 random bytes in URL-safe base64. Changing it signs everyone out and has no other effect.

## Running the login end to end

`pnpm test:e2e` starts the API on port 8000 (`pnpm api:dev`) and Vite on 5173, which proxies `/api`, unless they are already running. It needs `pnpm db:up`, `pnpm db:migrate` and the Zitadel values in `.env`, and it uses the installed Google Chrome, so no Playwright browser download is needed. The `e2e` CI job runs the same tests. It writes `.env` from the repository secrets `ZITADEL_DEV_CLIENT_ID`, `ZITADEL_DEV_CLIENT_SECRET`, `ZITADEL_TEST_USERNAME` and `ZITADEL_TEST_PASSWORD` with a fresh `SESSION_KEY`, and uses the runner's Google Chrome. Playwright traces record typed values, including the password, so CI keeps traces off and uploads no artifacts. Pull requests from forks get no secrets, so their `e2e` job fails.

The invitation tests sign the test user in, make it a platform operator for one call to invite its own address into a fresh workspace, and read the link from the file outbox that `playwright.config.ts` turns on with `EMAIL_BACKEND=file`. Helpers shared by the specs live in `apps/e2e/tests/support.ts`. `psql -tAc` prints `INSERT 0 1` after a `RETURNING` value, so take the first line.

The API tests in `apps/api/tests/test_auth.py` use a fake identity provider behind `httpx2.MockTransport`. It signs real RS256 ID tokens, checks PKCE and rotates refresh tokens, so the client's verification runs without Zitadel.

## Row-level security skips rows silently

An `UPDATE` that row-level security filters out changes nothing and raises nothing, so a route can answer 200 while nothing was written. Workspace settings that members may change belong in a tenant-owned table such as `session_policies`, never in `tenants`, which only the platform scope writes. Tests should read a change back. Source: IAM-009 log entry.

## Cookie writes need the app origin

`parfocal_api.origin_check.OriginCheck` refuses a POST, PUT, PATCH or DELETE that carries the session cookie and no bearer token unless `Origin` is the public origin, or `Sec-Fetch-Site` is `same-origin` when `Origin` is missing ([ADR 0087](../adr/0087-origin-check-on-cookie-writes.md)). A test client that holds a session cookie must send `Origin`, as `signed_in_browser` does with `http://localhost:5173`. Without it every write answers 403 `cross-origin-write`. Tests that override the principal through `ApiAs` send no cookie and are not affected.
