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
5. Ran `apps/e2e/tests/passkey.spec.ts` once on the TEST-040 stack (compose project `iam023`), then removed both projects with their volumes.

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
| E2E, lock and unlock with a passkey | Not reached. The full viewer showed "Loading the slide" without the account menu, so the spec now locks with the same `lock-screen` event the menu sends. Not run again |

## Interpretation

- The hosted login asks for credentials with an empty relying party ID, and the filter in `WebAuthNsToCredentials` keeps only passkeys stored without one, which is what the console and the registration link store. The user API v2 stores the domain it is given or the requested one.
- `amr` carries `mfa`, so a passkey satisfies a workspace that requires two factors under ADR 0366 (the API enforces a workspace's second factor from the amr claim).
- Production runs on Zitadel Cloud, whose version and login were not checked here.

## Follow-ups

- The lock and unlock half of `passkey.spec.ts` needs one run on the stack, in the TEST-040 CI job or by the next agent.
