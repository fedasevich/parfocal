# 0410. A signature needs a sign-in from the last 5 minutes, proved by the identity provider's auth_time

- Date: 2026-11-20
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: PROTO-134 (signing with single sign-on asks for the sign-in step every time). Closes the TODO in [ADR 0244](0244-evaluation-versions-and-changes-after-sign-off.md) (evaluation versions and changes after sign-off) that the single sign-on confirmation was only recorded, and carries out the confirmation [ADR 0134](0134-clinical-report-per-case-with-sign-out-and-co-sign.md) (clinical report per case with sign out and co-sign) asks for.

## Context

The deployed walkthrough of v0.29.1 found that "Sign with single sign-on" signed a task sign-off, a clinical sign out and a co-sign in one click. The web waited 800 ms and sent `confirmed_with`, and the API stored it. The password fallback never sent the password. Nothing proved that the person at the screen was the signer. ADR 0244 named the fix, the existing `reauth` login with `prompt=login`, and left three things open: how recent the sign-in must be, what the password fallback becomes, and whether one sign-in covers more than one signature.

## Options

1. Trust the session. Any signed-in session may sign. This is what shipped, and it proves nothing.
2. Ask the identity provider for a fresh sign-in before every signature, with no window. Every signature costs a full sign-in, including two in a row on the same page.
3. Accept a signature only when the session's sign-in, as the identity provider states it in the ID token's `auth_time`, is at most 5 minutes old. The web asks for the sign-in step (`prompt=login` and `max_age=0`) when the API refuses.

## Decision

Option 3.

- The session keeps the ID token's `auth_time` in its sealed tokens. A token refresh keeps the time of the sign-in. A token without `auth_time` is never fresh.
- `signOffReviewTask`, `signCaseReport` (sign out and co-sign) and `cosignClinicalReport` refuse with 403 `fresh-sign-in-needed` unless that time lies within the last 5 minutes, with 30 seconds of clock skew. The check holds whatever `confirmed_with` says, so a `password` body is no way around it.
- The `reauth` login sends `prompt=login` and `max_age=0`, which per OpenID Connect makes the provider authenticate again and return `auth_time`.
- On the refusal the web remembers the signature for 5 minutes in session storage, starts the `reauth` login with the signer's email as `login_hint` and returns to the same page, which opens the signing window again and signs once. A second refusal shows the existing error and does not loop.
- The password fallback signs in with the app's own password sign-in, which Zitadel checks, and then signs with `confirmed_with` `password`. A wrong password shows an error and signs nothing.
- One sign-in covers every signature inside its 5 minutes. The window is short enough that the person who signed in is still the person at the screen.

## Consequences

- Production Zitadel needs no setting change. OpenID Connect requires `auth_time` in the ID token when `max_age` is sent, and `prompt=login` is a standard request. TODO: confirm on app.parfocal.eu that a signature after the sign-in step goes through, since only the fake identity provider is tested.
- A session from a silent single sign-on, where the provider reused an older sign-in, carries that older time and asks for the sign-in step on the first signature.
- The fake API refuses a signature until a `reauth` login or a password sign-in happens in the tab, so specs walk the sign-in step.
