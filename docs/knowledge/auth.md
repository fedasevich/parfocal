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

`SESSION_KEY` is 32 random bytes in URL-safe base64, or a comma-separated list of them, newest first. The first seals and any opens, so prepending a new key signs nobody out, and removing the old one signs out only sessions not refreshed since ([knowledge/secrets.md](secrets.md#session-and-token-key-overlap)).

## Running the login end to end

`pnpm test:e2e` starts the API on port 8000 (`pnpm api:dev`) and Vite on 5173, which proxies `/api`, unless they are already running. It needs `pnpm db:up`, `pnpm db:migrate` and the Zitadel values in `.env`, and it uses the installed Google Chrome, so no Playwright browser download is needed. The `e2e` CI job runs the same tests. It writes `.env` from the repository secrets `ZITADEL_DEV_CLIENT_ID`, `ZITADEL_DEV_CLIENT_SECRET`, `ZITADEL_TEST_USERNAME` and `ZITADEL_TEST_PASSWORD` with a fresh `SESSION_KEY`, and uses the runner's Google Chrome. Playwright traces record typed values, including the password, so CI keeps traces off and uploads no artifacts. Pull requests from forks get no secrets, so their `e2e` job fails.

The invitation tests sign the test user in, make it a platform operator for one call to invite its own address into a fresh workspace, and read the link from the file outbox that `playwright.config.ts` turns on with `EMAIL_BACKEND=file`. Helpers shared by the specs live in `apps/e2e/tests/support.ts`. `psql -tAc` prints `INSERT 0 1` after a `RETURNING` value, so take the first line.

The API tests in `apps/api/tests/test_auth.py` use a fake identity provider behind `httpx2.MockTransport`. It signs real RS256 ID tokens, checks PKCE and rotates refresh tokens, so the client's verification runs without Zitadel.

## The identity provider config is a module with a scratch run

`infra/tofu/modules/zitadel-identity` holds the project, one confidential OIDC app per environment, the organisation's login, password and lockout policies and optional test users. It takes an organisation id and has no provider block, so a root calls it once per organisation. The values and their reasons are in the three IAM-001 (identity provider deployment and configuration) ADRs on the module, the separate organisations and the sign-in factors.

`bash infra/tofu/idp-scratch/run.sh` proves the module on an empty Zitadel, the same `infra/local/zitadel.compose.yaml` container that `make dev` starts, under its own compose project and ports (`IDP_SCRATCH_PROJECT`, `IDP_SCRATCH_PORT`, `IDP_SCRATCH_MAILPIT_PORT`). It needs Docker and OpenTofu and no credential, takes about two minutes, and removes its containers and local state when it ends. It applies, requires an empty second plan, reads the result back with `check.py`, wipes the container, and does the same once more on a new instance. The `idp` workflow runs it on every change to the module or the scratch root.

- Every Zitadel resource in the module carries `org_id`. Without it each plan wants a replacement, which would rotate the client secrets.
- The test user depends on the password policy. Created before it, Zitadel checks the password against the instance default and refuses one without a symbol. The scratch run uses a lowercase hex password so a wrong order fails every time.
- A test user's `initial_password` is write-only and never reaches the state. Changing it later means replacing the user.
- For a bogus authorization code, Zitadel's token endpoint answers `invalid_request` when the client secret is right and `invalid_client` when it is wrong. `check.py` uses that to prove a secret without a browser.
- The self-hosted image needs `ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED=false` to run without the separate login container.
- Moving the live apps into the module needs `moved` blocks. Deleting `zitadel.tf` without them destroys the production app.

## Per-workspace SAML sign-in

[ADR 0347](../adr/0347-per-workspace-saml-sso-through-zitadel.md) (per-workspace SAML sign-in) has the design. `tenant_command connect-saml` configures the workspace's Zitadel organisation and `sso_connections`, `/api/auth/sso?domain=` starts the flow, and `parfocal_api.sso` turns the token into a membership. Lessons from the spike on Zitadel v4.20.3:

- The hosted login (version 1) takes SAML responses at `{issuer}/ui/login/login/externalidp/saml/acs`. The `/idps/<id>/saml/acs` address in the SP metadata belongs to the version 2 intent flow and answers `Errors.Intent.NotStarted`. The SP entity id is `{issuer}/idps/<id>/saml/metadata`.
- An IdP that sends a transient NameID, like SimpleSAMLphp, needs `transientMappingAttributeName`, or the login stops with `Errors.Intent.MissingSingleMappingAttribute`.
- A custom login policy with zero check lifetimes sends the browser back to the IdP forever.
- Without an Action that sets the profile, auto-creation stops at a registration form. Metadata written with `api.v1.user.appendMetadata` arrives in the ID token as base64url JSON under `urn:zitadel:iam:user:metadata`.
- User names are unique across the instance unless the organisation's domain policy sets `userLoginMustBeDomain`, so without it a second organisation cannot auto-create a user name that exists elsewhere (`unique_constraints_pkey` in the Zitadel log). `connect-saml` sets that policy through `/admin/v1/orgs/<id>/policies/domain`, and [ADR XXXX](../adr/XXXX-sso-links-an-existing-account-by-verified-email.md) (SSO links an existing account by verified email) joins the two Zitadel users in our database.
- Organisation IdPs are listed by `/management/v1/idps/templates/_search`. The older `/management/v1/idps/_search` returns none of them.
- The sign-in screen's "Sign in with your organisation" takes a domain or a work email and sends the browser to `/api/auth/sso`. An unknown domain comes back to `/sign-in?sso=none` with the return path kept.
- `apps/e2e/tests/sso.spec.ts` runs the test IdP on `PARFOCAL_SAML_IDP_PORT` (default 8091) and provisions and deprovisions its own workspace. CI pulls the amd64 image before the tests.

## Row-level security skips rows silently

An `UPDATE` that row-level security filters out changes nothing and raises nothing, so a route can answer 200 while nothing was written. Workspace settings that members may change belong in a tenant-owned table such as `session_policies`, never in `tenants`, which only the platform scope writes. Tests should read a change back. Source: IAM-009 log entry.

## Cookie writes need the app origin

`parfocal_api.origin_check.OriginCheck` refuses a POST, PUT, PATCH or DELETE that carries the session cookie and no bearer token unless `Origin` is the public origin, or `Sec-Fetch-Site` is `same-origin` when `Origin` is missing ([ADR 0087](../adr/0087-origin-check-on-cookie-writes.md)). A test client that holds a session cookie must send `Origin`, as `signed_in_browser` does with `http://localhost:5173`. Without it every write answers 403 `cross-origin-write`. Tests that override the principal through `ApiAs` send no cookie and are not affected.
