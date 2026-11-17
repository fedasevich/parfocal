# Result: passkey sign-in on the hosted login of the local Zitadel

- Date: 2026-11-17
- Backlog: IAM-023 (sign in and unlock with a passkey)
- Kind: spike
- Commit: e4c8ce4a plus the IAM-023 working tree
- Environment: MacBook, macOS 15, Docker, `ghcr.io/zitadel/zitadel:v4.20.3` from `infra/local/zitadel.compose.yaml` under the compose project `iam023-zitadel` on port 8193, configured by `infra/tofu/idp-local`, Chrome with the CDP virtual WebAuthn authenticator (CTAP2, internal, resident key, user verification)
- Data: the local test user `e2e-pathologist@parfocal.test`, no PHI

## Question

Can the BFF login reach a passkey prompt on the pinned Zitadel, what does `login_hint` and `prompt=login` do, which `amr` does a passkey sign-in carry, and what happens when the passkey window is cancelled?

## Method

1. A Node script with Playwright enrolled a passkey for the test user in two ways: through `POST /v2/users/{id}/passkeys` with and without `domain`, and through `POST /v2/users/{id}/passkeys/registration_link` with `returnCode`, opening `/ui/login/login/passwordless/init` with the returned code.
2. It opened `/oauth/v2/authorize` with `login_hint`, again in the same browser, and with `prompt=login`, pressed "Login with passwordless", exchanged the code and decoded the ID token.
3. It turned user verification off on the virtual authenticator and pressed the button again.
4. Read `internal/webauthn/converter.go` and `internal/command/user_human_webauthn.go` at tag v4.20.3.
5. Ran `apps/e2e/tests/passkey.spec.ts` on the TEST-040 stack (compose project `iam023`) twice, once before and once after the hint moved into a POST body, and removed both projects with their volumes after each run.

## Results

| Case | Outcome |
| --- | --- |
| Passkey from user API v2, with or without `domain` | Hosted login fails with `BeginLoginFailed`, "Found no credentials for user" |
| Passkey from the registration link page | Hosted login signs in |
| `login_hint` with a passkey enrolled | Lands on "Login Passwordless", no login name page |
| Same browser, no `prompt` | Back at the callback with no page |
| `login_hint` and `prompt=login` | "Login Passwordless" again |
| `amr` after a passkey sign-in | `["user", "mfa"]` |
| User verification refused | The page shows "The operation either timed out or was not allowed" and keeps "Login with passwordless" and "Login with password" |
| E2E, cancelled window then retry from the app's sign-in page | Passed |
| E2E, passkey sign-in to a slide deep link | Signed in to the slide path |
| E2E, lock and unlock with a passkey | First run: not reached, the full viewer showed "Loading the slide" without the account menu. Second run, at 7c3866fb, with the hint posted to the BFF and the lock sent by the same `lock-screen` event the menu sends: passed, back at the same URL with its camera, and the API container logs held no copy of the email |
| Fake E2E, passkey unlock compares the slide's viewBox | Passed 3 times in a row. The older account menu lock spec failed 2 of 4 repeats, once with and once without the session lock change, a flake in that spec |

## Interpretation

- The hosted login asks for credentials with an empty relying party ID, and the filter in `WebAuthNsToCredentials` keeps only passkeys stored without one, which is what the console and the registration link store. The user API v2 stores the domain it is given or the requested one.
- `amr` carries `mfa`, so a passkey satisfies a workspace that requires two factors under ADR 0366 (the API enforces a workspace's second factor from the amr claim).
- Production runs on Zitadel Cloud, whose version and login were not checked here.

## Follow-ups

- None. The spec runs in the TEST-040 CI job.
