# Result: Neon point-in-time restore drill

- Date: 2026-11-18
- Backlog: OPS-008
- Kind: spike
- Commit: see the git log entry for this file
- Environment: Mac (Darwin 24.6), `neonctl` 9.6.0, Neon project `parfocal-eu` (`still-field-25034761`, Frankfurt, Free plan, Postgres 18, 0.25 CU, 6 hours of history)
- Data: the production database `neondb` as it stood, 47.3 MiB logical size, owner test data only, no PHI

## Question

Can production's Postgres be recovered from the provider's own history into a separate target, how long does it take for the current database size, and do the restored data match the source.

## Method

1. Picked a timestamp three minutes in the past, `2026-11-18T00:06:04Z`.
2. Created the branch `drill-ops008-pitr` from branch `main` at that timestamp with `neonctl branches create --parent <timestamp> --expires-at 2026-11-18T02:30:00Z`. Nothing was written to or restored over `main`.
3. Connected to the branch and to `main` as `neondb_owner`, and ran `parfocal_deploy.restore_check.fingerprint` on both (row count and md5 of all rows for every table, extensions, invalid indexes, unvalidated constraints) and `compare` between them.
4. Read the migration head of both.

## Results

| Measure | Value |
| --- | --- |
| Branch create call, wall clock | 1.27 s |
| Branch state after the call returned | `init`, then `ready` at the next poll |
| Branch create to first successful query, including fetching the connection string | 1.52 s |
| Fingerprint of the restored branch | 3.37 s |
| Tables compared | 99 |
| Rows, restored branch | 10635 |
| Rows, `main` | 10635 |
| Findings from `compare` | 0 |
| Migration head, restored branch and `main` | `0137` and `0137` |
| Branch in recovery mode | no, it accepts writes |

## Interpretation

At 47 MiB a point-in-time branch is usable in seconds, because Neon branches copy on write and do not move data. The time will not stay this small as a share of the recovery: an outage also needs the API and edge pointed at the branch, which this drill did not do. That step replaces the live database, so it is the owner's to run (see decision 149 in `docs/decisions.md`).

The comparison is of the branch against live `main` a few minutes later, and it matched exactly, which holds only because the development database was idle in that window. A busier database would show differences for rows written after the timestamp. The 6 hour history window is the real recovery point limit on this plan. Nothing older than 6 hours can be restored from Neon itself.

The drill branch could not be deleted by the agent, because the destructive-action guard refuses `neonctl` delete. It expires by itself at `2026-11-18T02:30:00Z`. Its compute suspends after 5 idle minutes, so its cost is a few CU-minutes of the free 100 CU-hours, which is 0 dollars.

## Follow-ups

- Objectives and the runbook are in [disaster-recovery.md](../knowledge/disaster-recovery.md).
- Decision 149 in `docs/decisions.md` asks about the cross-region copy and the promotion step.
- TODO: a drill of the object side (R2 lock recovery of tenant objects) and a first run of the monthly restore workflow, both still open under SEC-014 (backups and restore testing).
