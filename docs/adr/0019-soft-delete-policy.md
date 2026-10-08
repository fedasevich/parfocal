# 0019. Soft delete only for user-deletable clinical records, hard delete only by retention jobs

- Date: 2026-10-08
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: FOUND-013. Touches CASES, ANN, REPORT, COLLAB and the retention tasks in SEC and OPS

## Context

FOUND-013 asks for a soft-delete policy before the first tables exist. Pathology records carry retention duties, a user who deletes a case or annotation by mistake needs it back, and every clinically relevant change goes to the audit log (Definition of Done item 5). Tables also differ: sessions, job steps and caches have no clinical meaning, and annotations get an append-only version table (STACK-021).

## Options considered

1. A `deleted_at` column on every table, filtered everywhere. One rule, but every query and unique constraint has to remember the filter, and tables without clinical meaning grow forever.
2. No soft delete. Delete rows and rely on the audit log and backups. Simple queries, but restoring a mistaken delete means a backup restore, and retention rules can be broken by one click.
3. Soft delete for records a user can delete and that have clinical or legal weight, hard delete for everything else, and hard deletion of clinical records only through retention jobs.

## Decision

Option 3.

- Cases, specimens, slides, annotations, reports and comments get the `SoftDeletable` mixin from `parfocal_common.db`, a nullable `deleted_at`. Deleting sets it and writes an audit entry. Restoring clears it and writes another.
- Row-level security policies stay tenant-only. Deleted rows are hidden by the repository layer's default filter, so admin restore views and retention jobs can still see them. Unique constraints on those tables are partial indexes `WHERE deleted_at IS NULL`.
- Everything else (sessions, job and step tables, caches, outbox rows) is deleted for real.
- Soft-deleted clinical rows are purged only by a retention job that follows the tenant's retention setting and writes an audit entry per purge.

## Consequences

- Each soft-deletable table needs the partial unique indexes and the default filter, which CASES-001 and ANN-001 set up first.
- Storage keeps growing with deleted rows until retention runs, which is acceptable at pilot scale.
- Annotation history stays in its version table, so `deleted_at` on the current row is enough to hide it.
