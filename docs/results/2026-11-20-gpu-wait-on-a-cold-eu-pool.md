# Result: a Best call waited 6.5 minutes for an EU GPU and ended in a result without a 524, but the wait log lines carry no wait time

- Date: 2026-11-20
- Backlog: OPS-038 (a GPU call waiting for an EU GPU shows the wait, not an error)
- Kind: deployed check
- Commit: `cf89e64a` (v0.27.1 as deployed on app.parfocal.eu)
- Environment: Modal environment `main`, apps `parfocal-api` and `parfocal-gpu-pool`, every GPU pool pinned to region `eu`. Client was a Playwright script on a MacBook with Apple M4, signed in as the agent test account
- Data: `test_065` in the seeded project "Vendor format robustness", no PHI

## Question

OPS-038 waits for the deployed smoke on a cold pool, the T4 and L4 options in Modal, the "gpu call waiting" and "gpu call answered" log lines, and a result file on EU waits a week after deploy. Which of these hold on 2026-11-20?

## Method

1. Read the v0.27.1 deploy workflow (GitHub Actions run 44725184791) and its "browser-smoke" job log. The smoke cannot run from this Mac because it needs `PARFOCAL_SMOKE_EMAIL` and `PARFOCAL_SMOKE_PASSWORD`.
2. With no `parfocal-gpu-pool` container running, posted one Best embedding call for `test_065` and polled it as ADR 0404 (a GPU call answers waiting and is polled) describes, recording every answer.
3. Read `modal billing rates`, the pool settings in `workers/ml/src/parfocal_ml/gpu_pool.py`, and the logs with `modal app logs parfocal-api --env main --since 3d --search "gpu call"` and `modal app logs parfocal-gpu-pool --env main --since 25m`.

## Results

The browser smoke of the v0.27.1 deploy passed 6 tests and skipped 2 in 2.1 minutes. Its Best test took 38.8 s and its view map test 10.2 s. Its embedder container's first line came at 12:13:29 CET, seven seconds after its request, so the pool was cold.

This check's own call on a cold pool:

| Time (CET) | What happened |
|---|---|
| 12:21:35 | call sent |
| 12:22:20 to 12:27:39 | eight answers of 202 `waiting`, each after the 45 s hold, `waited_seconds` from 45.4 to 364.0 |
| from 12:22:40 | the pool logged "Function 'embedder' … is waiting to be scheduled on [GPU_T4, GPU_L4] worker" with Modal's hint that relaxing `region=eu` may schedule faster |
| 12:28:04 | container's first line, on an L4 by the billing report |
| 12:28:22 | 200 with the ViT-L embedding, 407.7 s after the call |

No answer was a 502, 503, 504 or 524.

GPU options. `modal billing rates` lists Nvidia T4 at $0.59 an hour and L4 at $0.80 an hour, with no region multiplier shown. The pools in `gpu_pool.py` use these:

| Pool | GPU | Containers at most | Scale-down |
|---|---|---:|---:|
| interactive embedder | T4, falling back to L4 | 1 | 300 s |
| four batch pools | two on L4, two on T4 | 2, 2, 1, 1 | 60 s |
| one CPU pool | none | 1 | 60 s |

Log lines from `parfocal-api` in the three days to 2026-11-20 12:40 CET:

| Hour (UTC) | "gpu call waiting" | "gpu call answered" |
|---|---:|---:|
| 2026-11-19 13 | 0 | 6 |
| 2026-11-19 14 | 5 | 3 |
| 2026-11-19 16 | 14 | 2 |
| 2026-11-19 18 | 2 | 3 |
| 2026-11-19 19 | 1 | 4 |
| 2026-11-19 21 | 5 | 6 |
| 2026-11-19 23 | 1 | 3 |
| 2026-11-20 06 | 0 | 3 |
| 2026-11-20 11 | 8 | 7 |

In every one of these lines the fields `gpu_kind`, `waited_seconds` and `slow_wait` read `[redacted]`. `packages/py-common/src/parfocal_common/scrubbing.py` keeps only the fields in `ALLOWED_FIELDS`, and these three are not in it. The request lines do keep `duration_ms`, and each waiting answer shows about 45,400 ms, of which `db_ms` reports almost all.

## Interpretation

- The waiting protocol works on the deployed app. A call that waited 6.5 minutes for an EU GPU ended in a result, and no 524 reached the client.
- The smoke passed on a cold EU pool in the v0.27.1 deploy, where the GPU came after about seven seconds.
- The week-later result file cannot be written from these logs as they are, because the wait time and the slow wait flag are scrubbed. Counting waiting lines per call from request IDs is not possible either, since each poll is a new request.
- That `db_ms` covers the 45 s hold suggests the request's timing span, or a database transaction, stays open while the API waits for the GPU. This check did not look further.

## Follow-ups

- `TODO` add `gpu_kind`, `waited_seconds` and `slow_wait` to the log allowlist, or log the wait under an allowed field, before the week of data starts. This needs a code change, which this check did not make.
- `TODO` the result file on how often the EU wait passed 60 s, a week after the allowlist change is deployed.
- `TODO` find out whether the 45 s hold keeps a database connection open, which matters when several people wait at once.
