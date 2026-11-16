# 0352. SSO links an existing account by verified email

- Date: 2026-11-16
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: IAM-028 (SSO from the sign-in screen and the SSO spec in CI). Follows [ADR 0347](0347-per-workspace-saml-sso-through-zitadel.md) (per-workspace SAML sign-in).

## Context

A person who signed up with a password as `ada@hospital.example` and whose hospital then connects its SAML IdP could not sign in through SSO. Zitadel auto-creates the SSO user in the workspace's organisation with the email as user name, and user names are unique across the instance, so the creation failed on `unique_constraints_pkey`. Even with that fixed, the SSO user is a second Zitadel user with its own subject, and our `users` table is keyed by subject, so the person would get a second, empty Parfocal account.

## Options considered

1. Link in Zitadel. Turn on `isLinkingAllowed` and auto-linking by email on the IdP. The existing user lives in the Parfocal organisation, while the SSO request is scoped to the workspace's organisation, so Zitadel refuses the user or issues a token whose resource owner is not the connected organisation, and our callback can no longer tell that SSO vouched for it.
2. Keep two Zitadel users and link in our database. Scope Zitadel user names to the workspace organisation, so the SSO user is created, and map its subject to the existing Parfocal user on the first SSO sign-in.
3. Leave the accounts apart and tell the person to use one of them. Their decisions, comments and memberships would stay on the password account, out of the workspace.

## Decision

Option 2.

- `connect-saml` sets the organisation's domain policy to `userLoginMustBeDomain`, which makes Zitadel check user names per organisation.
- Migration 0124 adds `linked_subjects` (subject, user id, the vouching workspace, created at), readable and writable only in the auth and platform scopes. Erasing a person deletes their links, so a linked IdP subject cannot sign in to the erased account.
- On an SSO callback, a token subject already in `linked_subjects` signs in as the linked user. Otherwise, when the connected workspace vouches for the email's domain, the token subject is new to us, and exactly one Parfocal user has that email, the subject is linked to that user. That user's email is only ever stored when the identity provider said it was verified. Platform operators are never linked.
- The session carries the linked user's subject, so every place that reads `users.subject` stays as it was.
- The link writes a `user.sso-linked` audit event in the workspace with `"source": "sso"`. Linking gives no admin rights, and the workspace role still comes from the groups.
- Deleting the user or the workspace deletes its links.

## Consequences

- Trust grows: a workspace's IdP can now sign in as any existing Parfocal user whose email is in that workspace's domains, including memberships in other workspaces. That is the same reach the domain's mail server already has through password reset, and a domain belongs to one workspace only, set by an operator with `connect-saml`. Domain ownership is not proven by DNS yet (`TODO` before the first customer connection).
- A password sign-in after linking still works and lands on the same Parfocal user.
- `apps/api/tests/test_sso.py` covers the link, a second sign-in through it, an unverified account and an email outside the domains. `apps/e2e/tests/sso.spec.ts` links a real Zitadel password account on the local stack.
