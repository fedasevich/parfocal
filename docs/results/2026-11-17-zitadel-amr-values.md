# Result: amr values and second factor prompts of the local Zitadel

- Date: 2026-11-17
- Backlog: IAM-025 (ask for a second factor at sign-in when a workspace requires it)
- Kind: spike
- Commit: 61245cac
- Environment: MacBook, macOS 15, Docker, `ghcr.io/zitadel/zitadel:v4.20.3` from `infra/local/zitadel.compose.yaml`, configured by `infra/tofu/idp-local`
- Data: the local test user `e2e-pathologist@parfocal.test`, no PHI

## Question

ADR 0366 (the API enforces a workspace's second factor from the amr claim) left three facts unchecked. Which `amr` values does Zitadel put in the ID token after a password and a second factor? Which console path lets a user set up a factor? Does the hosted login with `prompt=login` ask for a factor the user has enrolled?

## Method

1. Started a private Zitadel with `PARFOCAL_ZITADEL_PROJECT=iam025-zitadel PARFOCAL_ZITADEL_PORT=8189 bash infra/local/zitadel-up.sh`, so it shared nothing with other local stacks.
2. Session API path. With the admin token, enrolled TOTP (`POST /v2/users/{id}/totp` and `/totp/verify`) and OTP email (`POST /v2/users/{id}/otp_email`) for the test user. Then for each case, started an authorize request with the header `x-zitadel-login-client`, built a session with the login client token (`POST /v2/sessions` with user and password checks, then `PATCH /v2/sessions/{id}` with a TOTP code or an OTP email code from a `returnCode` challenge), finished it with `POST /v2/oidc/auth_requests/{id}`, exchanged the code at `/oauth/v2/token` and decoded the ID token.
3. Hosted login path, the one the web uses (`/ui/login`). A small Python client with a cookie store filled the login forms. It removed the factors, signed in with a password only, enrolled TOTP through the API, then signed in again without `prompt` in the same browser and with `prompt=login` in a fresh one.
4. Console path. Fetched `/ui/console/users/me` and searched the console bundle for its routes.
5. Read `internal/api/oidc/amr.go` and the login's `mfaChecked` in `internal/auth/repository/eventsourcing/eventstore/auth_request.go` at tag v4.20.3.
6. Stopped the containers and removed the volume with `docker compose -p iam025-zitadel down --volumes`.

## Results

| Sign-in | Pages of the hosted login | `amr` in the ID token |
| --- | --- | --- |
| Password only, session API | none | `["pwd"]` |
| Password and TOTP, session API | none | `["pwd", "otp", "mfa"]` |
| Password and OTP email, session API | none | `["pwd", "otp", "mfa"]` |
| Hosted login, fresh browser, `prompt=login`, TOTP enrolled | login name, password, second factor | `["pwd", "otp", "mfa"]` |
| Hosted login, same browser after enrolment, no `prompt`, password still fresh | second factor | `["pwd", "otp", "mfa"]` |
| Hosted login, password only, no factor enrolled | login name, password, then the prompt to set up a factor | not finished |

- No token carried `acr`.
- `/ui/console/users/me` answers 200, and the console's `users` routes have `path:"me"`, whose page holds the console's multifactor section (`cnsl-auth-user-mfa`, with TOTP, OTP email, OTP SMS and security key).
- In the source, `AuthMethodTypesToAMR` adds `pwd` for a password, `user` for a security key or passkey, one `otp` for any of TOTP, OTP SMS, OTP email or a recovery code, and `mfa` once two factors are counted. A passkey counts as two.

## Interpretation

- `mfa` is the right value to look for, and the API and its tests already use it with these exact lists.
- `prompt=login` makes the hosted login ask for the login name and password again, and then for an enrolled factor, so "Sign in again" on the refusal card yields `mfa` once a factor exists.
- The session API accepted an OTP email check even though the login policy offers only TOTP and security keys, so the policy limits what the hosted login offers, not what counts.
- A security key and a passkey were not measured, because they need a WebAuthn device. The source says both yield `mfa`.
- Production runs on Zitadel Cloud, whose version was not checked here.

## Follow-ups

- ADR 0366 (the API enforces a workspace's second factor from the amr claim) drops its three unchecked TODOs and links here.
- No API code changed.
