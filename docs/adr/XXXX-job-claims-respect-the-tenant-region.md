# XXXX. Job claims respect the tenant region behind one switch

- Date: 2026-11-16
- Status: Proposed
- Deciders: Claude (SEC-005 agent)
- Backlog: SEC-005 (data residency enforcement), OPS-020 (pin storage, database and Modal functions per region)

## Context

Every tenant already has a `region` of `eu` or `us`. All work runs from one Postgres `jobs` table, and every worker, the ingest worker and the GPU model run alike, takes work through `jobs.claim()`. Production runs unpinned in Modal US East and holds EU tenants, and [ADR 0003](0003-pilot-platform-architecture.md) (pilot platform architecture) says regions stay unpinned until the first tenant with real patient data. The rule has to exist and be tested now, but it must not stop production today.

Modal names its regions `eu`, `eu-west`, `eu-north` and `eu-south` for the European Economic Area and `us`, `us-east`, `us-central`, `us-south` and `us-west` for the United States, and sets `MODAL_REGION` in each container to the narrow name when there is one. `uk` is not in the EEA.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Filter in `claim()` on the tenant's region, joined at claim time | One place covers every worker. No migration. A job moved to another tenant region is never stale | A join per claim, on a small table |
| 2. A `region` column on `jobs` copied at enqueue | The job row says where it may run | An additive migration, a copy that can drift from the tenant, and every enqueue path must fill it |
| 3. One Modal function and queue name per region | Placement is visible in the Modal dashboard | Doubles the deployed functions and the cron count, and still needs a check in the claim |

## Decision

Option 1. A worker knows its placement from `MODAL_REGION` and from `PARFOCAL_RESIDENCY=enforced`. With the switch off, which is the default, `claim()` adds no condition and the pilot runs as before. With it on, a worker claims only jobs of tenants whose region holds its Modal region. A worker with no region or a region outside the two lists, such as `uk`, claims nothing. A job that no worker may take stays `queued` and is never failed. GPU pools take an optional Modal `region`, unset today, and a pool pinned outside the two lists is rejected.

## Consequences

- `apps/api/tests/test_data_residency.py` fails if an EU tenant's job is claimed by a US, UK or unknown queue, and proves the pilot still runs EU jobs on the unpinned US queue.
- Turning the switch on is the PHI trigger of ADR 0003. It needs pinned Modal functions (1.15 times compute for `eu`), an R2 jurisdiction bucket with the objects copied, and a Neon project in the EU region. Each one raises spend or replaces production resources, so each is asked of the owner. OPS-020 (pin storage, database and Modal functions per region) holds that work.
- A deployment serves one region per worker, so a platform with tenants in both regions needs a worker pinned in each before the switch goes on.
