# 0027. Audit log as an append-only Postgres table with a hash chain per workspace and people named by erasable pseudonyms

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: SEC-003, SEC-024, SEC-006, SEC-007, IAM-007, IAM-017

## Context

SEC-003 asks for an append-only audit table with hash chaining that records PHI reads, clinically relevant writes and permission changes, with an export for auditors. Definition of Done item 5 makes every later task write to it. Postgres is the only system of record ([ADR 0003](0003-pilot-platform-architecture.md)), every table has forced row-level security ([ADR 0018](0018-postgres-sqlalchemy-rls.md), [ADR 0024](0024-workspaces-are-tenants.md)), and the app reaches Postgres through PgBouncer in transaction mode. Role changes from IAM-006 were not audited yet ([ADR 0026](0026-roles-and-permission-matrix.md)).

## Options considered

1. Where the log lives. A separate log service or object storage with object lock is harder to tamper with, but an event could then be lost when the business transaction commits and the log write fails, and it adds a cloud dependency the pilot does not have yet. A table in the same database is written in the same transaction as the change, so an audited change and its entry commit or roll back together.
2. One chain or several. One global chain serialises every write in every workspace and makes a workspace's history unverifiable without everyone else's. One chain per workspace, plus one platform chain for events without a workspace (sign-in, sign-out, new organisations), keeps writers independent and lets a workspace's export be verified on its own.
3. Who computes the hash. The API could read the chain head and compute the hash, but then every writer must lock correctly and any code path could insert a wrong hash. A `BEFORE INSERT` trigger takes a transaction-scoped advisory lock on the chain, assigns the sequence number, the time and the previous hash and computes SHA-256 itself, so nothing the app sends can break or fake the chain. The payload is length-prefixed text in a fixed field order, and the timestamp is formatted explicitly, so the same hash can be recomputed outside Postgres from the export.
4. How people are named. Storing the IdP subject or user id in each entry makes the person identifiable for as long as the log exists, and the chain stops anyone from removing them when GDPR erasure (SEC-007) applies. Keeping personal details in a separate table that entries point to by user id still leaves a stable id that other tables reuse. A pseudonym per person, kept in its own erasable table `audit_people` and used nowhere else, leaves entries that point to nobody once the row is deleted, while the chain stays intact.
5. How entries are protected. Grants alone stop the app role but not the owner. A trigger alone can be dropped by the owner. Both together: the app role has no `UPDATE`, `DELETE` or `TRUNCATE` on the table, and a trigger refuses updates, deletes and truncation for everyone until an owner deliberately disables it, which the chain then exposes.

## Decision

A table `audit_events` in the same database, written in the same transaction as the change, with a chain per workspace and one platform chain, hashed by a trigger, protected by grants and a trigger.

- `parfocal_api.audit.record` is the only writer. Each entry holds the actor's kind and pseudonym, the action, the target type and id, and canonical JSON details. People, whether actor or target, appear only as pseudonyms from `audit_people`, which maps each pseudonym to an IdP subject. Details never hold PHI or names, only ids and codes.
- Erasing a person from the log is `parfocal_api.audit.forget`, which deletes their `audit_people` row in the platform scope. Their entries and the chain stay, but no longer say who it was. A workspace sees only the pseudonyms of people it can already see (itself and its members), so the mapping does not leak across workspaces, and operators show up only as the `operator` kind in a workspace's export.
- Row-level security follows the workspace. A member's scope writes and reads its own workspace's chain, the platform scope any chain, and the auth scope only the platform chain.
- `GET /api/tenant/audit-events` (`listAuditEvents`) returns a workspace's events in order with their hashes, filtered by target if asked, and resolves pseudonyms to subjects where the mapping still exists and is visible. It needs the `audit-log` permission, so leads and administrators read it. `chain_breaks` in `parfocal_api.audit` recomputes the chain from the export and names every entry that does not match.
- Recorded now: organisation and workspace creation, suspension and reactivation, members added, role changes, sign-in and sign-out. Case, slide and report events are recorded by the tasks that build those features, with action names added to `AuditAction`.

## Consequences

- An audited change cannot commit without its entry, and a failed audit write fails the request.
- Writes to one workspace's chain are serialised by the advisory lock. That is fine at pilot volume. TODO: measure when CASES adds case-open events, which are the most frequent.
- An owner can still rewrite a table and recompute every hash after it. TODO: SEC-024's signed export, or a periodic anchor of each chain head outside the database, closes that gap.
- Erasure (SEC-007) calls `forget` and does not touch the chain. Retention (SEC-006) still conflicts with an append-only log. TODO: decide there whether old entries are purged by cutting the chain and re-anchoring it with a recorded purge.
- Case ids and other target ids stay in entries. They are not personal data on their own, but SEC-007 must check that nothing else maps them back to a patient after erasure.
- IAM-007 and IAM-017 can now record their steps. SEC-024 builds its queries and signed export on this table.
