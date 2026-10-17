# 0056. Signing rights, supervision and stored signatures are removed

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: ADAPT-003 (revert signing rights and supervision), supersedes [ADR 0032](0032-signing-rights-on-the-membership.md) for IAM-018 (supervision and signing rights)

## Context

[ADR 0032](0032-signing-rights-on-the-membership.md) put signing rights on the membership: a nullable "signs alone" override, a named supervisor, and a signature image on the user that a consultant needed before signing out. All of it served the clinical sign-out report and supervisor co-sign, which [ADR 0053](0053-ai-results-review-direction.md) made ideas. In the new product a researcher signs off an evaluation as a soft lock (ADJ-004), and that sign-off is confirmed by signing in again rather than by a stored signature.

## Options considered

1. Keep the columns and endpoints for the co-sign idea. Nothing in the product would read them, and ADR 0053 asks for unused hospital code to go.
2. Remove them. If supervision comes back, it can be rebuilt from git history together with the report it serves.

## Decision

Option 2. `memberships.signs_alone`, `memberships.supervisor_user_id`, `users.signature` and `users.signature_added_at` are gone, together with `parfocal_api.signing`, its four endpoints (`getSigningRights`, `changeSigningRights`, `putSignature`, `deleteSignature`) and the audit actions `member.signing-changed`, `user.signature-added` and `user.signature-removed`. Migration `0010` was deleted and `0011` now follows `0009` ([ADR 0054](0054-hospital-code-inventory-and-revert-order.md)). No signature image existed outside local databases, so none had to be deleted with an audit entry. Old audit rows keep their action strings.

## Consequences

- Changing a member's role no longer resets a signing override.
- The grants "needs co-sign" and "as named supervisor" are still in the matrix until ADAPT-001 (hospital-only permissions) removes them with the sign-out permissions.
- ADJ-004 (sign-off as a soft lock) decides how a sign-off is confirmed.
