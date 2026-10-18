# 0090. People export their own data, project owners export and erase patients, and an erased person keeps their work under "Former member"

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (owner's choices on 2026-10-18)
- Backlog: SEC-007, SEC-006, SEC-004

## Context

SEC-007 asks to export all personal data for a data subject and to erase or pseudonymise on request where law allows. Two kinds of people have data in Parfocal: the people who work in it (researchers, reviewers, admins) and patients in clinical projects. Parfocal is a processor for patient data, so a patient's request reaches the workspace that holds them. Patient identifiers are sealed with per-workspace keys and searched by blind indexes on the patient row ([ADR 0033](0033-envelope-encryption-with-tenant-data-keys.md), [ADR 0034](0034-blind-indexes-for-encrypted-patient-identifiers.md)), which left open whether a patient needs their own key. Audit entries name people by erasable pseudonyms ([ADR 0027](0027-audit-log-hash-chain-in-postgres.md)). Review assignments, verdicts, opinions and emergency grants point at memberships, so a membership with work cannot simply be deleted.

## Options considered

For a patient, the owner chose between erasing the patient only and keeping the cases, erasing the patient and all their slides and reviews, and per-patient keys with shredding. For a person, the owner chose between pseudonymising them and keeping their work, and deleting their work too.

For finding a person's data:

1. A hand-written list of tables. Clear, but a new table that points at a person would be missed silently.
2. Every workspace table with a `user_id` or `*_user_id` column, found from the table models, plus tables matched by email and the global ones handled by name, with a test that fails when a personal column is in none of those.

## Decision

The owner's choices, with option 2 for finding the data.

- `GET /api/me/personal-data` gives a signed-in person their profile, their sessions and, for each workspace they belong to, every row that names them (secrets, ciphertexts and geometries left out), the invitations sent to their email and the audit entries where they are the actor or the target. Each workspace's audit log records the export.
- `GET /api/projects/{project}/patients/{patient}/personal-data` gives a project owner the patient's decrypted identifiers, their cases and the slides of those cases with the result sets and review tasks on each. `DELETE /api/projects/{project}/patients/{patient}` erases the patient row with its sealed identifiers and blind indexes and unlinks their cases, which stay with their slides, results and reviews as de-identified data. A legal hold on the project or the workspace refuses the erasure (409 `legal-hold`). Both are audited without identifiers. Only owners of the project may do either, because they are the ones who manage its patients.
- `POST /api/platform/users/{user}/erase` is for platform operators, because a person can belong to several workspaces. It replaces the name, email, initials and title with "Former member", gives the account a new random subject so the old sign-in no longer finds it, forgets the audit pseudonym, ends every session and clears availability notes. Memberships with no work are removed, and memberships that verdicts, assignments or grants still point at stay so the work keeps its author id. The person's verdicts, opinions, edits and added objects stay, so signed-off evaluations do not change.
- Per-patient keys are not added. Backups keep erased rows until they expire. TODO: SEC-014 states the backup period.

## Consequences

- SEC-007 ships the three routes and tests for each workflow end to end, plus the coverage test.
- Restriction of processing (GDPR Art. 18) stays a gap in [compliance/controls.md](../compliance/controls.md).
- Case labels can themselves identify a patient (an accession number). The workspace must relabel a case if needed before or after erasure. TODO: decide with SEC-008 (de-identified projects) whether erasure should offer that.
- A former member still appears in member lists of the workspaces where their work keeps a membership. IAM-020 (deactivation with hand-over) can hide them.
