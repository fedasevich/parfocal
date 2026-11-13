# 0294. Native sign-up and password sign-in through Zitadel's session and OIDC v2 APIs

- Date: 2026-11-13
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-027 (real sign-up and sign-in from the app's own screens)

## Context

The app's sign-up and sign-in screens were drafts. Signing in sent people to Zitadel's hosted login, and nobody could create an account from the app. [ADR 0025](0025-zitadel-bff-login.md) keeps every token on the server behind the `__Host-parfocal_session` cookie, so whatever replaces the hosted screens must still end in that cookie and never hand a token to the browser.

## Options considered

1. Keep the hosted login and only restyle it. This needs no service user, but the app's own screens stay fake and the hosted login cannot match the frozen mock.
2. Call Zitadel from the browser. This puts a privileged token or a Zitadel session in the browser, which ADR 0025 forbids.
3. Run a custom login on the API server. The API calls Zitadel's user service v2 to create the user and send the email code, the session service v2 to check the password, and the OIDC service v2 to finalize the auth request. It then exchanges the code exactly like the hosted callback does and opens the same BFF session.

## Decision

Option 3.

- The API holds a personal access token of a Zitadel service user with the `IAM_LOGIN_CLIENT` role, set as `ZITADEL_LOGIN_CLIENT_ID` and `ZITADEL_LOGIN_TOKEN`. `ZITADEL_ORGANIZATION_ID` optionally places new users in one organisation. Without the first two the native endpoints answer 404, `GET /api/auth/password-sign-in` answers `available: false` and the web app keeps sending people to the hosted login.
- Sign-up (`POST /api/auth/sign-up`) creates a human user with a password and asks Zitadel to mail the code, then checks the password into a Zitadel session at once. The user id and that session are sealed with the session cipher into the Strict `__Host-parfocal_signup` cookie for 30 minutes, so the confirm step works only in the same browser.
- Confirming (`POST /api/auth/sign-up/confirm`) verifies the code, starts an auth request by calling `/authorize` with the `x-zitadel-login-client` header, finalizes it with `POST /v2/oidc/auth_requests/{id}` and the session, checks the returned state, exchanges the code with PKCE, verifies the nonce and opens the BFF session. The person lands on `/setup?step=role`.
- Password sign-in (`POST /api/auth/sign-in`) uses the same session and finalize path. An unknown email and a wrong password give the same 401, and an unverified email gives 403.
- Zitadel sends the mail itself, because the app's own production mail is not wired yet.
- SSO and passkeys stay on the hosted login for now.
- Every attempt is throttled to 10 a minute per hashed email.

## Not yet checked against a real Zitadel

The tests use a faked Zitadel built from the v2 API docs. These must be checked once the service user exists:

- whether `/authorize` with the login client header answers 302 or another redirect status,
- the exact status codes for a duplicate user, a rejected password and a wrong code,
- whether a password check and finalize work before the email is verified,
- the instance's password complexity policy, which the app's hint text assumes,
- the email code alphabet. The default is six upper-case letters and digits, while the web input keeps only digits, so either the generator becomes digits only or the input accepts letters.

## Consequences

The production API needs one more secret, and a leaked login token lets its holder create users and sessions, so it lives only in the Modal secret. The hosted login stays as the fallback, so turning the feature off is removing the two settings.
