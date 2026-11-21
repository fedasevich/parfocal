# Result: a Best embedding on a cold GPU pool answered in 27.7 s without a wait, on a T4 in AWS us-east, and the wait log lines now carry their fields

- Date: 2026-11-21
- Backlog: OPS-038 (a GPU call waiting for an EU GPU shows the wait, not an error) and AISEG-024 (Best one-click outlines run PathoSAM ViT-L on the server)
- Kind: deployed check with cost
- Commit: `ad05cea` (v0.35.12 as deployed on app.parfocal.eu)
- Environment: MacBook with Apple M4, Playwright 1.65.1 with headless Chromium shell build 1248, signed in as the agent test account with its own session. Modal environment `main`, apps `parfocal-api` and `parfocal-gpu-pool`
- Data: `test_065` in the seeded workspace cvut-biomedical, views around nuclei from `packages/test-fixtures/model-results/test-065/cells.geojson`, no PHI

## Question

The [cold EU pool result](2026-11-20-gpu-wait-on-a-cold-eu-pool.md) (a Best call waited 6.5 minutes for an EU GPU) left the smoke on a cold pool, the log fields and the week of EU waits open, and the [deployed GPU seconds result](2026-11-20-best-one-click-deployed-gpu-seconds.md) measured Best on v0.27.1. What does v0.35.12 do?

## Method

1. `modal container list --env main` showed no `parfocal-gpu-pool` container, so the pool was cold.
2. A script posted `POST /api/slides/{test_065}/embeddings/view` for a 512 by 512 view around the first nucleus, following the waiting protocol of ADR 0404 (a GPU call answers waiting and is polled). A second call on another nucleus followed at once.
3. `modal container exec` on the new pool container read `MODAL_REGION`, `MODAL_CLOUD_PROVIDER` and `nvidia-smi` only.
4. In the viewer the script opened `test_065`, pressed `s`, picked Best, clicked the stage centre and read the smart layer's attributes.
5. Read the "browser-smoke" job of the v0.35.12 deploy (GitHub Actions run 44887141576), `modal app logs parfocal-api --env main --since 2d --search "gpu call"`, and `modal billing report --for today -r h --tz local --show-resources --json`.

## Results

| Call | Pool | Client time | Answers | Encoder | Bytes |
|---|---|---:|---|---|---:|
| Best embedding, first | cold | 27,691 ms | one 200, no 202 | `pathosam-vit-l-histopathology-fp32` | 2,097,152 |
| Best embedding, second | warm | 3,137 ms | one 200 | same | 2,097,152 |
| Best click in the viewer | warm | 12,481 ms from click to ready, including the decoder download | `embeddings/warm` 204, `embeddings/view` 200 | same | |

The smart layer after the click read `data-encoder="server"`, `data-phase="ready"`, `data-live="1"` and `data-confidence="0.41"`, with one proposal and no encoder fallback notice.

The pool container `ta-01M804FS49Y910590WFPNBSHJR` ran in `us-east` on `CLOUD_PROVIDER_AWS` with a Tesla T4. The deploy sets no `PARFOCAL_GPU_REGION`, so under ADR 0407 (GPU pools run in any region until real data arrives) no pool is pinned to the EU.

The v0.35.12 deploy's browser smoke passed 6 of 6 tests in 2.7 minutes. The Best test took 53.5 s.

Log lines of `parfocal-api` in the two days to 22:45 UTC on 2026-11-21:

| Line | Count | Largest `waited_seconds` | Over 60 s |
|---|---:|---:|---:|
| "gpu call answered" | 72 | 55.5 | 0 |
| "gpu call waiting" | 1, at 01:07 UTC, `view-embedding`, 49.1 s | | |

No line had a redacted field. `gpu_kind`, `waited_seconds` and `slow_wait` are in the log allowlist. This check's two calls logged `waited_seconds` 27.3 and 2.6 with `slow_wait` false.

GPU options in `workers/ml/src/parfocal_ml/gpu_pool.py`: two batch pools on L4 and two on T4, the interactive embedder on T4 with L4 as its fallback, and one CPU pool. `modal billing rates` was not read again in this check.

Cost. Read at 22:51 UTC with the hour still open, the `parfocal-gpu-pool` lines for the hour from 23:00 local time read T4 $0.187, memory $0.010, CPU $0.003 and egress $0.002. That hour also holds another agent's GPU calls and a typer call, so this check's share is not separable.

## Interpretation

- The Best path works on v0.35.12. Cold costs about 28 s and warm about 3 s, with the ViT-L embedding from the server.
- "A cold EU pool" no longer exists while ADR 0407 holds, because pools run in any region. The smoke passed on whatever pool Modal gave it.
- The week of EU waits cannot be written. The fields are logged now, but pools are no longer in the EU.

## Follow-ups

- `TODO` the GPU seconds of this check alone, which need a window with no other GPU traffic.
- `TODO` the owner or the task says whether OPS-038's EU wait result still applies under ADR 0407.
