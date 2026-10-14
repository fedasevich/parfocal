# 0030. Invitations bound to a verified email, accepted by a signed-in person, with operators inviting first administrators

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: IAM-007, IAM-014, IAM-019, STACK-036

## Context

IAM-007 asks that admins invite by email with a role, that invites expire, that acceptance creates the membership, and that E2E tests and the audit log cover each step. People sign in through Zitadel and the API keeps its own users and memberships ([ADR 0025](0025-zitadel-bff-login.md)). Until now operators could add only people who had already signed in once, so nobody could bring the first administrator into a new workspace. The real email sender is not built, and outside production email goes to the console ([ADR 0005](0005-external-sends-only-in-production.md)).

## Options considered

1. Who may accept. Anyone holding the link is simple, but a forwarded or leaked link would let the wrong person in. Binding the invitation to the email address and requiring that the signed-in account has that address keeps a leaked link useless. The IdP's `email_verified` claim decides whether an address counts.
2. How people sign up. Inviting through Zitadel's own user creation would put IdP objects under our API's control and needs IdP rights agents may not hold. Letting the invitee sign in or register with Zitadel as usual and then accept in our API keeps the IdP untouched.
3. How end-to-end tests read the link. A real mailbox needs a provider and credentials in CI. A file outbox, a third local email backend next to console and memory, lets tests and developers open the link without sending anything.

## Decision

- Leads and administrators (`manage-people`) invite through `/api/tenant/invitations` and may list and withdraw pending invitations. Operators invite through `/api/platform/tenants/{id}/invitations`, which is how a new workspace gets its first administrator.
- An invitation stores the lower-cased address, the role (never outside consultant), a SHA-256 hash of a random token, and expires after 7 days. The email carries `{origin}/invitations/{token}`. Inviting the same address again withdraws the earlier link.
- `POST /api/invitations/accept` needs a signed-in person whose verified email matches. It creates the membership, makes the workspace active, and records `invitation.accepted` and `member.added`. Login now stores the email only when the IdP says it is verified.
- Expired links answer 410 and record `invitation.expired`. Withdrawn and unknown links answer 404. Used links answer 409.
- `EMAIL_BACKEND=file` appends each message as a JSON line to `EMAIL_OUTBOX` (default `.outbox/email.jsonl`, git-ignored). The Playwright config sets it, so the E2E tests read the link from there.

## Consequences

- A person whose IdP address is not verified cannot accept anything. Zitadel verifies addresses at registration, and the dev test user is verified.
- The `/invitations/{token}` page does not exist yet. TODO: a web task adds it once the UI is final. Until then the link is only useful through the API.
- The email is sent before the transaction commits, so a rare commit failure leaves an email with a dead link. The invitee then gets a 404 and asks again.
- Invited addresses are personal data kept after acceptance. TODO: SEC-006 sets how long.
- STACK-036's Resend client implements the same `EmailSender` interface, and invitation templates move there.
