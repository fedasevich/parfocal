# 0089. Retention purges expired soft-deleted records through one database function, and old audit entries are purged with a re-anchor

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (owner's choice on the audit purge, 2026-10-18)
- Backlog: SEC-006, SEC-007, SEC-003

## Context

SEC-006 asks for per-workspace retention for slides, annotations, reports and audit records, with legal hold. [ADR 0019](0019-soft-delete-policy.md) says clinical rows are soft-deleted and hard-deleted only by a retention job that follows the workspace's setting and audits each purge. The app role cannot delete annotations, their versions, result rows or audit entries at all, by design. [ADR 0027](0027-audit-log-hash-chain-in-postgres.md) left a TODO: whether old audit entries are purged by cutting the chain and re-anchoring it. No report is stored yet, and only annotations and result sets can be deleted through the API today.

## Options considered

For the purge itself:

1. Grant the app role DELETE on the clinical tables and purge from Python. Simple, but any flaw in the API could then hard-delete clinical data, which the revoked grants exist to prevent.
2. One `SECURITY DEFINER` function, owned by the migration role, that purges only what the workspace's own stored policy allows, inside the caller's tenant scope, and returns what it removed. The app role may call it and nothing else.

For old audit entries, the owner chose between purging with a re-anchor, never purging, and exporting before purging.

## Decision

Option 2, with the owner's re-anchor choice.

- `retention_policies` holds per workspace `deleted_after_days` (at least 1) and `audit_after_days` (at least 365, a floor so a compromised setting cannot wipe recent history). Both are empty by default, which keeps everything. Admins set them with `PUT /api/tenant/retention`.
- `legal_holds` hold one project or, with no project, the whole workspace, with a reason, who placed it and when it was released. Admins place and release them. Holds cannot be deleted.
- `parfocal_retention_purge()` deletes annotations (with their versions), result sets (with their classes, objects and chunks) and slides whose `deleted_at` is older than the policy, unless their project is held, a review task still pins the result set or slide, or the slide still has result sets or annotations. It reports what it kept and why. A workspace hold stops every purge, the audit purge included.
- Audit entries older than `audit_after_days` are deleted as a prefix of the workspace's chain under the chain's advisory lock. The append-only trigger allows a delete only while the function sets `parfocal.audit_purge`, which only the function's owner can act on because DELETE stays revoked. The job then appends `audit.purged` with `through_seq`, `last_hash` and `count`, and `chain_breaks` starts from that anchor when the oldest remaining entry is not the first.
- The `retention` workflow runs the function once per workspace on the job engine and writes one `retention.purged` entry per purged annotation, result set and slide. `schedule_retention` queues at most one job per workspace in 20 hours. `python -m parfocal_api.retention` schedules and works once, for a daily cron.

## Consequences

- SEC-006 ships the tables, the function, the workflow, the policy and hold routes and tests for purging, keeping held and pinned records, the audit anchor and a workspace hold.
- Stored files are not deleted yet, because nothing reaches storage. TODO: when INGEST-001 and STACK-025 land, the purge returns the slide's storage keys and a step deletes them.
- Reports have no table yet. TODO: add them to the function when report PDFs are stored (EVAL-003).
- Cases and patients cannot be deleted yet. TODO: purge them here once a delete route exists, and coordinate with SEC-007 (erasure).
- The daily cron is a deployment job and waits for cloud work. TODO: schedule `python -m parfocal_api.retention` on Modal.
- ADR 0027's TODO on purging is settled by this record.
