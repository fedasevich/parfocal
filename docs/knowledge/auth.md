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
| Session lifetime | 12 h fixed, `last_seen_at` updated at most once a minute. IAM-009 makes it configurable |
| Platform operators | `uv run --package parfocal-api --env-file .env python -m parfocal_api.operators add <zitadel-user-id>`, also `remove` and `list` |
| Test user | `e2e-pathologist@parfocal.eu` in Zitadel's `Parfocal` organisation, password in `.env` as `ZITADEL_TEST_PASSWORD`, MFA not set up |

`SESSION_KEY` is 32 random bytes in URL-safe base64. Changing it signs everyone out and has no other effect.

## Running the login end to end

`pnpm test:e2e` starts the API on port 8000 (`pnpm api:dev`) and Vite on 5173, which proxies `/api`, unless they are already running. It needs `pnpm db:up`, `pnpm db:migrate` and the Zitadel values in `.env`, and it uses the installed Google Chrome, so no Playwright browser download is needed. The `e2e` CI job runs the same tests. It writes `.env` from the repository secrets `ZITADEL_DEV_CLIENT_ID`, `ZITADEL_DEV_CLIENT_SECRET`, `ZITADEL_TEST_USERNAME` and `ZITADEL_TEST_PASSWORD` with a fresh `SESSION_KEY`, and uses the runner's Google Chrome. Playwright traces record typed values, including the password, so CI keeps traces off and uploads no artifacts. Pull requests from forks get no secrets, so their `e2e` job fails.

The API tests in `apps/api/tests/test_auth.py` use a fake identity provider behind `httpx2.MockTransport`. It signs real RS256 ID tokens, checks PKCE and rotates refresh tokens, so the client's verification runs without Zitadel.
