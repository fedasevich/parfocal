# 0366. The API enforces a workspace's second factor from the ID token's amr claim

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-025 (ask for a second factor at sign-in when a workspace requires it). Builds on [ADR 0291](0291-sign-in-factors-offered-by-the-idp-and-required-by-the-workspace.md) (sign-in factors offered by the IdP and required per workspace by the API).

## Context

ADMIN-009 (real sign-in settings in Admin) saves `two_factor_required` per workspace, and ADR 0291 (sign-in factors offered by the IdP) keeps Zitadel's login policy the same for every workspace, with TOTP and WebAuthn offered and no forced second factor. Something has to refuse a one-factor session in a workspace that requires two, and the user needs a way out of that refusal.

## Options considered

1. Send `acr_values` at sign-in and trust the IdP to step up. Zitadel does not promise a second factor for an `acr_values` request, and the workspace is not known before sign-in, so the API would still have to check.
2. Read the `amr` claim of the ID token, keep it with the session, and refuse a session without `mfa` on every request into a workspace that requires two factors.
3. Turn on `force_mfa` for the whole organisation. One variable, but it applies to every workspace, which ADR 0291 (sign-in factors offered by the IdP) rejected.

## Decision

Option 2.

- The callback seals the ID token's `amr` list into the session blob beside the tokens, so no migration is needed. A refreshed ID token that leaves `amr` out keeps the earlier list. A session sealed before this change has no list and counts as one factor, so it fails closed.
- A session counts as two factors when `amr` holds `mfa`. Zitadel adds `mfa` when two factors were checked, or one passkey that counts as two. Real tokens from the local Zitadel v4.20.3 carry `["pwd"]` after a password alone and `["pwd", "otp", "mfa"]` after a password and TOTP or an OTP email code ([result](../results/2026-11-17-zitadel-amr-values.md), amr values and second factor prompts of the local Zitadel).
- `authenticate` checks the active workspace's switch only for a one-factor member session, so a two-factor session costs no extra query. It answers 403 with the code `second-factor-required`. A 403 keeps the web from treating it as signed out and looping through the sign-in page.
- Switching into a workspace that requires two factors is refused the same way, before the session moves. This does not cover every way in. Sign-in lands on the last workspace, and joining or accepting an invitation also moves the session, and once a one-factor session sits in a strict workspace the refusal covers switching out too. Such a member must enrol, or sign out. TODO: the owner decides whether switching out of a strict workspace should stay open.
- The web covers the app with a card that offers three ways out. "Set up a second factor" goes to `/api/auth/second-factor`, which redirects to the Zitadel console's own user page (`/ui/console/users/me`), which holds the console's multifactor section in v4.20.3. "Sign in again" uses the hosted login with `prompt=login`, which asks for the login name, the password and then the enrolled factor, as the local Zitadel showed. "Log out" ends the session.
- The password form on the sign-in page only checks a password, so it never yields two factors. A member of a strict workspace must use the hosted sign-in.

## Consequences

- An admin who turns the switch on from a one-factor session is refused on the next request and must set up a factor. The toast says so.
- SSO users get whatever `amr` the external IdP passes through Zitadel, which may not include `mfa`. Revisit with IAM-012 (per-organisation SSO).
- The enrolment prompt at sign-in can be skipped for 720 hours, so the card's link to the Zitadel console is the dependable route to enrol.
- The Admin Security page no longer says the setting is not enforced.
