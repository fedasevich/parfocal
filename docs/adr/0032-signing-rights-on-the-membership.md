# 0032. Signing rights on the membership, decided by one function, changed only by a lead

- Date: 2026-10-14
- Status: Superseded by 0056
- Deciders: Yurii Fedas
- Backlog: IAM-018, REPORT-019, SEC-023, REPORT-008

## Context

IAM-018 asks that a person record holds whether they may sign alone, their supervisor if not, and whether a signature is on file, that a resident's sign-out becomes a send-for-review, that a consultant without a signature cannot sign, and that changes are a lead's audited action. The UX kit's W48 shows a "Signs out alone" switch ("Residents do not sign alone. Turning this on is a lead's decision and is logged"), a supervisor who receives the resident's reports for co-sign (Flow 14), and a signature area ("Consultants cannot sign out until one is on file", "Not needed while co-signed"). The matrix of [ADR 0026](0026-roles-and-permission-matrix.md) gives residents "needs co-sign" and lets administrators change roles, but says nothing about supervision.

## Options considered

1. Where the rights live. On the person, they would follow someone into every workspace, though a resident in one department may be a consultant's peer in another. On the membership, they belong to the workspace where the supervision happens.
2. How to store "signs alone". A plain boolean would need a default written at every insert and rewritten at every role change. A nullable override, empty meaning the role's default (consultants and leads sign alone, residents do not), keeps the default in code and lets a role change reset it.
3. Where the signature image lives. Object storage fits large files, but nothing here uses it yet and work stays local. A PNG of at most 100 kB in a `bytea` column is small, transactional and erasable with the person.
4. Who changes the rights. Following the matrix's "change roles" row would let administrators decide clinical supervision. W48 names the lead, so the route narrows the matrix and the permission test lists that narrowing explicitly.

## Decision

- `memberships` gains `signs_alone` (nullable override) and `supervisor_user_id`. `users` gains `signature` and `signature_added_at`.
- `parfocal_api.signing.decide(role, signs_alone, supervisor, signature_on_file)` is the one rule. A role without sign-out is refused (`no-sign-out-right`). A person who does not sign alone sends for review to their supervisor, or is refused (`no-supervisor`) when none is named, and needs no signature. A person who signs alone needs a signature on file (`no-signature`). REPORT-019 and the sign-out tasks call this function rather than repeating it.
- A lead may let a resident sign alone, which W48 draws, so the matrix's "needs co-sign" is the default, not a hard limit.
- `GET /api/tenant/members/{id}/signing` (team readers) shows the rights and the decision with its message. `PUT` is for leads only, never on themselves, and the supervisor must be another member of the workspace who signs alone. Changes are audited with pseudonyms, never user ids.
- A person uploads and removes their own signature through `PUT` and `DELETE /api/me/signature`, both audited.
- Changing someone's role clears the override, so the new role starts from its default.

## Consequences

- REPORT-019 and SEC-023 can rely on one decision function and on the supervisor link.
- A supervisor whose own rights later change keeps their supervisees. TODO: REPORT-019 must refuse a review sent to a supervisor who no longer signs alone or left the workspace.
- Signature images are personal data, readable by colleagues through the users table's policy. TODO: SEC-007 erases them with the person.
