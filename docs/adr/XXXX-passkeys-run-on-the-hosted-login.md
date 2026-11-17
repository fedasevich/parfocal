# XXXX. Passkeys run on Zitadel's hosted login, named by a login hint

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-023 (sign in and unlock with a passkey)

## Context

The sign-in page and the lock screen need a passkey button. The app signs in with a password through its own form, which drives Zitadel's session API with the login client ([ADR 0291](0291-sign-in-factors-offered-by-the-idp-and-required-by-the-workspace.md), sign-in factors offered by the IdP and required per workspace). A passkey is bound to the relying party ID it was created for, and ADR 0291 leaves enrolment on Zitadel's pages, so passkeys get Zitadel's domain.

## Options considered

1. Run the WebAuthn ceremony on the app's page through the session API (`challenges.webAuthN`, then `checks.webAuthN`). The app keeps its look, but the relying party ID would be the app's domain, and a passkey enrolled on Zitadel's domain is not offered there. Enrolment would have to move into the app as well.
2. Send the button to the BFF login with `login_hint` set to the email, and let Zitadel's hosted login run the ceremony. No enrolment change and no new API operation.

## Decision

Option 2. `GET /api/auth/login` takes an optional `login_hint` of at most 320 characters and passes it to the authorize request. The sign-in button sends the typed email, and the lock screen sends the locked user's email with `reauth=true`. The scratch run in [the passkey result](../results/2026-11-17-zitadel-passkey-login.md) shows that with the hint, Zitadel v4.20.3 opens its passwordless page straight away for a user with a passkey, `prompt=login` asks for the passkey again, and a cancelled window leaves that page usable.

## Consequences

- The user presses Zitadel's "Login with passwordless" before the browser's passkey window opens. The browser's own window offers the phone QR code and security keys.
- The hosted login only finds passkeys enrolled on Zitadel's pages (the console or a registration link). A passkey added through the user API v2 with an explicit `domain` stores that relying party ID, and the hosted login does not offer it. The E2E spec enrols through a registration link for this reason.
- A user without a passkey who presses the button lands on Zitadel's password page, which is still a way in.
- The in-app look of the mock passkey sheet (`PasskeySheet` in `packages/ui`) stays a prototype scene. Moving the ceremony in-app later means moving enrolment too, which needs a new decision.
