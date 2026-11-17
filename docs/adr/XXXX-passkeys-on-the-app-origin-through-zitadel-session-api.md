# XXXX. Passkeys belong to the app origin and go through Zitadel's session API

- Date: 2026-11-17
- Status: accepted
- Deciders: agent (claude parallel run), under the owner's request of 2026-11-17
- Backlog: IAM-032

## Context

IAM-023 (sign in and unlock with a passkey) sent the passkey button to Zitadel's hosted login with a login hint. A passkey made there belongs to `parfocal-iqcyh5.eu1.zitadel.cloud`, the app offered no way to save one, and the owner kept typing his password on app.parfocal.eu. Since IAM-027 (real sign-up and sign-in from the app's own screens) the app signs in through Zitadel's session API with a login service user, so the passkey can stay on the app's own page.

A probe on 2026-11-17 against the Zitadel Cloud instance, with the login service user's token and a scripted software authenticator on the agents' test user, showed that registering with `domain` `app.parfocal.eu`, verifying client data from `https://app.parfocal.eu` and checking an assertion in `PATCH /v2/sessions/{id}` all work with no trusted domain and no forwarded host header. `POST /v2/sessions` refuses a WebAuthn challenge without a user check (`User ID missing`), so a sign-in without an email first is not possible.

## Options

| Option | For | Against |
| --- | --- | --- |
| Hosted login keeps passkeys (IAM-023 as built) | No API work | Passkey bound to the Zitadel domain, no save step in the app, a redirect each time |
| Relying party is the app host, from `PUBLIC_ORIGIN` | Works on app.parfocal.eu as probed, one rule for every environment, `localhost` locally | A passkey saved on one host does not work on another, so a move to a new host asks people to save one again |
| Relying party is the registrable domain `parfocal.eu` | One passkey for every subdomain | Previews and staging would share passkeys with the real app, which the environments must not |

## Decision

The relying party ID is the host of `PUBLIC_ORIGIN`. The API registers passkeys with `registration_link` (return code) and `POST /v2/users/{id}/passkeys`, verifies them with the browser's credential, and signs in with a session that checks the user and asks for a WebAuthn challenge, then finishes the OIDC request as password sign-in does. The user ID for saving always comes from the BFF session. The sign-in page asks for the email first, keeps the last passkey email on the device and starts a conditional request with it, so the keychain offers the passkey in the email field. After a password sign-in on a device with a platform authenticator and no saved passkey, the app offers to save one, and Settings has an Add a passkey row.

## Consequences

Passkeys saved on Zitadel's hosted page do not work in the app, so people save one again after a password sign-in. Moving the app to another host invalidates every passkey. Removing a passkey and a passkey list with dates are not built yet.
