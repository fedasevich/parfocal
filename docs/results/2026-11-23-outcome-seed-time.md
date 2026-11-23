# Result: why the TEST-057 seed took 1314 s and what brings it back

- Date: 2026-11-23
- Backlog: TEST-057 (the seed shows every review outcome), against PROTO-139 (the production reseed finishes in under 15 minutes)
- Kind: benchmark with a latency model
- Commit: v0.39.0 (9b5a537d), v0.40.0 seed code (cf70bbcc) and the TEST-057 perf commit on top of d3905379
- Environment: Apple M4, local Postgres in the shared parfocal compose project, every seed connection sent through a scratch TCP proxy that holds each server reply for 85 ms, and every result store and object store call delayed by 60 ms. Both delays are model assumptions, not measured production values.
- Data: the showcase seed with an owner, one viewer and one agent email, the test `EmptyStore` and an in-memory result store (no PHI)

## Question

The reset-production run 45202007617 on v0.40.0 logged "reset: seed took 1314 s", against 468 s on v0.39.0 (run 45144791349). The earlier estimate for the new seed steps was about +140 s. Where did the rest go?

## Method

A scratch script ran `showcase.seed` through the proxy. It wrapped every seed step and the route functions the new steps call. For each one it recorded wall time summed over the three workspaces, SQL statements counted on that step's connection, and calls to the result and object stores. A sampler read `pg_stat_activity` every 0.2 s on a direct connection and counted the statements waiting on a lock. One run was made per tree, one at a time. The v0.39.0 run used a worktree of that tag with the same script.

## Results

| Tree | Whole seed | Statements | Store calls | Lock wait samples |
| --- | --- | --- | --- | --- |
| v0.39.0 | 422.5 s | 9631 | 474 | 440 on `INSERT INTO audit_people` |
| v0.40.0 | 783.7 s | 15213 | 501 | 2002 on `INSERT INTO audit_people` |
| After the fix | 584.4 s | 15212 | 501 | 8 on `INSERT INTO audit_people` |
| Rejected try, outcome review in its own transaction | 568.0 s | 15209 | 501 | 2455 on `INSERT INTO audit_events` |

On v0.40.0, `seed_states` alone summed 604 s over three workspaces for 1718 statements. After the fix the same step summed 199 s. Store calls are not the cause. The new outcome steps make 3 store calls per workspace in the whole run. The new outcome review costs about 1550 statements per workspace (save_decision at about 19 statements a call, update_queued_object at about 49 because it builds the queue three times).

Deployed against local, for the two trees with both numbers: v0.39.0 is 468 s against 422.5 s (1.11), and v0.40.0 is 1314 s against 783.7 s (1.68).

## Interpretation

The three workspaces seed side by side, and each holds one long transaction. Audit pseudonyms live in `audit_people`, which has one row per subject across all workspaces. The seeded people are the same users in every workspace. PROTO-139 created Ada's and the owner's pseudonyms before the workspaces start. TEST-057 made Rhea, Remy and Rui act through route functions, so the first workspace to audit one of them inserts a pseudonym row. The other two then wait on that uncommitted insert until the first workspace's whole project transaction commits, which runs the workspaces one after another. v0.39.0 already had a smaller share of this wait, from the existing reviewer steps in `seed_states`.

The fix creates the pseudonyms of every seeded person who acts (Ada, Rui, Rhea, Remy) up front with the owner's. A new round trip test fails when any seeded person gets a pseudonym that was not created up front. With Ada's pseudonym the only one created first, that test fails.

Running the outcome review in its own transaction next to the gallery tour gained only 16 s. The audit trigger takes a per-tenant advisory lock (migration 0119, painted maps purge) until commit, so two transactions in one workspace still run one after the other. It would also leave a half-seeded workspace if the outcome review failed, so it was dropped.

The larger deployed ratio on v0.40.0 fits lock waits growing with the length of the transaction being waited on. With the waits gone, the 1.11 ratio of v0.39.0 is the better guide, which puts the next deployed seed near 650 s. That is an estimate, not a measurement. The modelled seed is about 160 s over v0.39.0, which is close to the earlier statement-count estimate.

## After the fix was deployed

v0.40.1 with the fix (reset run 45236490355) logged "reset: seed took 980 s", not the estimated 650 s. Two more checks followed.

The same seed ran against a Postgres container of its own limited to 0.25 CPU and 1 GB of memory, the size of the production Neon compute (`autoscaling_limit_min_cu` and `max_cu` are both 0.25, in `aws-eu-central-1`). It took 588.0 s at 85 ms, against 584.4 s on the full-speed local Postgres. Database CPU is not the gap.

The "Set up job" log of each reset names the runner's region. The three runs differ.

| Run | Release | Runner region | Seed deployed | Seed local at 85 ms | Deployed over local |
| --- | --- | --- | --- | --- | --- |
| 45144791349 | v0.39.0 | us-east-1 | 468 s | 422.5 s | 1.11 |
| 45202007617 | v0.40.0 | us-west-2 | 1314 s | 783.7 s | 1.68 |
| 45236490355 | v0.40.1 | us-west-2 | 980 s | 584.4 s | 1.68 |

The seed runs on the GitHub runner and talks to Neon in Frankfurt one statement at a time. Its time is set by the round trip time between the two. It does not depend on anything that changed between the two later releases, since both have the same 1.68 ratio. From the ratios, a round trip costs about 94 ms from us-east-1 and about 143 ms from us-west-2. These are derived from the ratios, not pinged. GitHub picks the region per run, so the same code can take about 650 s or about 1000 s.

Each workspace's seed runs about 5000 statements one after another, and the audit trigger's per-workspace lock keeps them in sequence. Reaching 600 s from us-west-2 would mean cutting about 40% of them, which cannot be done without dropping seeded parts. The dropped options in the follow-ups save about 100 s in total.

The seed now prints `seed: <phase> took N s` to stderr for the workspace header, each workspace's states, styles, outcome review, projects, gallery tour, annotation example, agent examples and clinical case, and the seats. The next reset log shows the split as it happens.

## Follow-ups

- TODO: run the seed next to the database, for example as a function in the Modal app's `eu` region, which the reset calls instead of running the seed on the runner. At an EU round trip of about 10 to 20 ms the seed would be a fraction of today's time. The Modal image would need the 13 MB of `packages/test-fixtures` the seed reads, and a deploy to test it.
- TODO: read the `seed:` and `reset:` lines and the runner region on the next reset-production run.
- If the deployed seed stays over about 600 s, two more cuts are known. `update_queued_object` builds the queue three times a call, worth about 7 to 12 s per workspace, and the class decision example's filler answers could be one insert, worth about 16 s per workspace. The filler cut would skip the AI class snapshot and audit events that `save_decision` writes.
