# Result: tenant objects piled up behind the bucket lock

- Date: 2026-11-21
- Backlog: PROTO-141 (a reset leaves no tenant objects behind in the slide bucket)
- Kind: measurement
- Environment: R2 bucket `parfocal-dev-eu` (EU jurisdiction), read only, listed with the app key from the main checkout's `.env`
- Data: object counts, sizes and modification times only. No key names or contents were printed or stored (no PHI)

## Question

How many objects and bytes under `t/` have piled up because the seven day bucket lock refuses every delete, how old are they, what do they cost, and how should the reset treat them.

## Method

One read only `ListObjectsV2` walk of the prefix `t/` in pages of 1000, reading `Size` and `LastModified` of each entry. Ages were taken against the clock at listing time. Nothing was deleted and no bucket setting was changed.

## Results

| Measure | Value |
| --- | --- |
| Objects under `t/` | 12,334 |
| Bytes under `t/` | 62,871,457 (0.063 GB) |
| Youngest | 0.04 days |
| Median | 0.71 days |
| Oldest | 3.38 days |
| Older than the 7 day lock | 0 objects, 0 bytes |

| Day written | Objects |
| --- | --- |
| 2026-11-17 | 1,067 |
| 2026-11-19 | 4,900 |
| 2026-11-20 | 6,367 |

Storage at R2's $0.015 per GB a month is about $0.0009 a month, and the account is already past the free 10 GB, so that is the marginal cost. Even at ten times this pile the cost stays under one cent a month. The cost is not the problem. The key list is: each reseed adds 1,000 to 6,000 keys, and before this change every reset walked all of them and sent one refused delete per key.

## What changed

- `ObjectStore.list_objects` returns key, size and modification time. `list_keys` is built on it.
- The reset keeps `LOCK_AGE` of 7 days, the same number as `locked_days` in `infra/tofu/modules/environment/variables.tf`. `past_the_lock` drops every key younger than that before any delete is sent, so a reset sends no request the lock is certain to refuse. Keys at or past the lock age, and keys with no modification time, are deleted. A `ObjectLockedByBucketPolicy` refusal from clock skew is still tolerated, any other refusal still stops the reset.
- Tests in `workers/deploy/tests/test_reset.py` cover the age rule at the boundary (one second younger is skipped, exactly the lock age is deleted, no timestamp is deleted) and the local object store run, which passes a clock eight days ahead.

## Lifecycle rule

No bucket lifecycle rule was declared and no `tofu plan` was run. The reset is the cleaner way. The static policy in `infra/tofu/policy/static_test.rego` denies any lifecycle rule that deletes objects (`test_delete_transition_fails`), and ADR 0341 (old tenant objects tier to infrequent access) keeps expiry out of the buckets on purpose, so an expiry rule would also need a policy change. The pile is 0.063 GB, so the policy change is not worth it. Today nothing is old enough for the reset to delete either, because the bucket's `t/` objects are all under four days old. The first reseed after 2026-11-24 will be the first to remove old keys.

## Follow-ups

- TODO: after the first reseed that passes a lock age, read the `reset: empty tenant objects took N s` line and the removed count to confirm the older keys went.
- The reset still lists every `t/` key. At the current growth that is under 50,000 keys a week, about 50 list pages, which is not a cost worth a prefix scheme.
