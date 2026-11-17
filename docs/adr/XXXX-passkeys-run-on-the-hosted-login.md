# XXXX. Passkeys run on Zitadel's hosted login, named by a login hint

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-023 (sign in and unlock with a passkey)

## Context

The sign-in page and the lock screen need a passkey button. The app signs in with a password through its own form, which drives Zitadel's session API with the login client ([ADR 0291](0291-sign-in-factors-offered-by-the-idp-and-required-by-the-workspace.md), sign-in factors offered by the IdP and required per workspace). A passkey is bound to the relying party ID it was created for, and ADR 0291 leaves enrolment on Zitadel's pages, so passkeys get Zitadel's domain.

## Options considered

1. Run the WebAuthn ceremony on the app's page through the session API (`challenges.webAuthN`, then `checks.webAuthN`). The app keeps its look, but the relying party ID would be the app's domain, and a passkey enrolled on Zitadel's domain is not offered there. Enrolment would have to move into the app as well.
2. Send the button to the BFF login with `login_hint` set to the email, and let Zitadel's hosted login run the ceremony. No enrolment change.

## Decision

Option 2. The web posts `return_to`, `reauth` and `login_hint` (at most 320 characters) as JSON to `POST /api/auth/login`, a hidden route next to `GET /api/auth/login`. The BFF answers with the authorize location, and only that redirect to Zitadel carries `login_hint`, so the email never appears in our own URLs or request logs. The sign-in button sends the typed email, and the lock screen sends the locked user's email with `reauth=true`. The scratch run in [the passkey result](../results/2026-11-17-zitadel-passkey-login.md) shows that with the hint, Zitadel v4.20.3 opens its passwordless page straight away for a user with a passkey, `prompt=login` asks for the passkey again, and a cancelled window leaves that page usable.

## Consequences

- The user presses Zitadel's "Login with passwordless" before the browser's passkey window opens. The browser's own window offers the phone QR code and security keys.
- The hosted login only finds passkeys enrolled on Zitadel's pages (the console or a registration link). A passkey added through the user API v2 with an explicit `domain` stores that relying party ID, and the hosted login does not offer it. The E2E spec enrols through a registration link for this reason.
- A user without a passkey who presses the button should land on Zitadel's password page. `TODO`: the spike did not run that case.
- The lock screen takes the email from the profile, which the session lock now loads on every guarded page. A lock screen with no profile loaded sends no hint, and the user types the login name at Zitadel first.
- The email does reach Zitadel's own request URL and logs, which already hold the login name.
- Every measurement used the v1 hosted login, because the local compose sets `LOGINV2_REQUIRED` to false. `TODO`: check which login Zitadel Cloud serves in production.
- The in-app look of the mock passkey sheet (`PasskeySheet` in `packages/ui`) stays a prototype scene. Moving the ceremony in-app later means moving enrolment too, which needs a new decision.
