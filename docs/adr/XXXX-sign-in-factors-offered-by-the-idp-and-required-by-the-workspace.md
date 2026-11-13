# XXXX. Sign-in factors are offered by the IdP and required per workspace by the API

- Date: 2026-11-13
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-001 (identity provider deployment and configuration). Sets the ground for IAM-023 (sign in and unlock with a passkey) and IAM-025 (second factor at sign-in when a workspace requires it).

## Context

IAM-001 asks for an MFA policy with TOTP and WebAuthn. Zitadel's login policy belongs to an organisation. [ADR 0025](0025-zitadel-bff-login.md) (Zitadel behind the backend-for-frontend) keeps every user in one organisation, while ADMIN-009 (real sign-in settings in Admin) stores `two_factor_required` per workspace. The E2E user signs in with a password only, and the E2E helper already clicks "skip" when Zitadel offers to set up a second factor.

## Options considered

1. Force a second factor for the whole organisation. Simple and strict, but it cannot differ per workspace, it locks out the E2E user, and every researcher needs an authenticator before the first look.
2. Offer the factors and prompt for enrolment in the IdP, and let the API refuse a one-factor session for a workspace that requires two.
3. One Zitadel organisation per workspace, each with its own policy. This is where per-organisation SSO (IAM-012) leads, and it is far more than this task.

## Decision

Option 2, written in `infra/tofu/modules/zitadel-identity/policies.tf` and checked by the scratch run.

| Setting | Value | Why |
|---|---|---|
| Second factors | TOTP and WebAuthn (`OTP`, `U2F`) | The two the task names. No SMS and no emailed code, which are weaker and need a paid sender |
| Passkeys | Allowed (`PASSWORDLESS_TYPE_ALLOWED`, multi factor `U2F_WITH_VERIFICATION`) | IAM-023 needs the passwordless flow to exist |
| Forced second factor | Off | A workspace decides, see below |
| Enrolment prompt | Shown at sign-in, can be skipped for 720 hours | Nudges without blocking. A variable per organisation |
| Second factor and passkey check lifetime | 12 hours | The default session length of the app |
| Password check lifetime | 240 hours | Zitadel's default |
| Password | At least 12 characters, no character-class rules | Length over composition |
| Lockout | 10 wrong passwords or 5 wrong codes | Stops guessing. Unlocking is done in the Zitadel console |
| External identity providers, domain discovery, phone login | Off | None exists before IAM-012 |
| Unknown usernames | Not revealed | The password page shows either way |
| Registration | On | Sign-up runs on the hosted pages |

How the later tasks build on it:

- IAM-023 (passkeys) starts the same BFF login. Enrolment and the passkey window are Zitadel's pages, and no policy change is needed.
- IAM-025 (second factor per workspace) keeps the IdP policy as it is. The API reads how the user authenticated from the ID token and refuses to open a workspace with `two_factor_required` on a one-factor session, with a message that points to enrolment. Which claim carries this (`amr`) and its exact values is `TODO` for IAM-025 to read from a real token. If it turns out unusable, the fallback is `force_mfa` on the organisation, which is one variable.

## Consequences

- A user in a workspace that does not require two factors can stay on a password alone. That is the owner's product rule from ADMIN-009, and the Admin Security page says "not enforced yet" until IAM-025.
- The lockout lets someone who knows an email address lock that account by guessing. With pilot-sized user counts the owner unlocks by hand. Revisit when a customer reports it.
- The policy applies to production only when OPS-001 applies the module to the `Parfocal` organisation, which adds three policies and changes none.
- The compliance rows for password management and authentication in `docs/compliance/controls.md` name IAM-001, and the table above holds the settings they refer to.
