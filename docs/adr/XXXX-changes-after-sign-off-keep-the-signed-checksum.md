# XXXX. Changes after sign-off keep the signed checksum and are flagged in the report

- Date: 2026-11-06
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: ADJ-005 (changes after sign-off), builds on [ADR 0244](0244-evaluation-versions-and-changes-after-sign-off.md) (evaluation versions and changes after sign-off) and [ADR 0247](0247-annotate-slide-checks-and-sign-off.md) (annotate slide checks and sign-off)

## Context

ADR 0244 lets the owner change a signed review task with a reason and logs each change in `evaluation_changes`, and ADR 0247 logs owner edits on a signed annotate slide in the same table. The exports and the PDF compute their numbers from live data, so after such a change the numbers no longer match the checksum stored when the version was signed. The report has to say so.

## Options considered

1. Recompute the checksum over live data after every change. The checksum then no longer proves what was signed, and the stored one would differ from what the export shows.
2. Keep the checksum of the version as signed, flag the report as changed after sign-off and list every change with who, when, what and why.
3. Freeze the evaluation JSON at signing and export only that. Exports would hide the changes the owner made on purpose until v2 is signed.

## Decision

Option 2.

- `GET /api/review-tasks/{id}/evaluation-changes` (`listEvaluationChanges`) lists every change of the task across versions, for review and annotate tasks, with the version, who, when, the object, its slide, the change and the reason, and the signed version and checksum. Only readers of the whole task see it, reviewers and experts get `evaluation-hidden`.
- The PDF of a signed version with changes carries a flag line under the checksum saying the checksum is of the evaluation as signed and the numbers include the changes, and closes with a "Changes after sign-off" table.
- The JSON and GeoJSON stamps carry `changes_after_sign_off`, the count for the stamped version.

## Consequences

- Starting v2 and signing it gives a checksum that covers the changes again, and v1's changes stay listed under version 1.
- CSV exports carry the checksum header only, so a reader of a CSV alone does not see the flag.
