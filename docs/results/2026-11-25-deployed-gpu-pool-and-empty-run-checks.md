# Result: on v0.54.0 a whole slide run left the queue in 24 s on an A100-40GB in eu-west against a promised 24 min, and a real tissue rerun stored 2,428 cells, while the same image with seeded cells failed as run-cells-unstorable

- Date: 2026-11-25
- Backlog: OPS-042 (GPU pools take any GPU big enough in any region), PROTO-168 (a queued whole slide run starts within its promised time), PROTO-195 (find why a whole slide run on the test account returned nothing)
- Kind: deployed check and production read
- Commit: release v0.54.0, commit 6ea7bf5, named by `/api/status` as the release (deployed by the `deploy.yml` run of 2026-11-25 21:41 UTC)
- Environment: app.parfocal.eu (a development environment by ADR 0390), the account agent-walk in the seeded workspace cvut-biomedical (checked with `GET /api/me` before each run), API calls only, no browser and no screenshot. Modal SDK 1.6.3 with the owner's workspace token for logs and billing, Neon SELECTs on project `still-field-25034761`
- Data: synthetic-zlib.ome.tiff (1024 by 768) and CMU-1-Small-Region.svs (2220 by 2967) in P03 (Scanner format comparison), the slide "Case ready" in P01 (Sentinel node metastasis study), which is the same 2220 by 2967 image. Public slides, no PHI
- GPU jobs: 3 of the 4 allowed, one at a time

## Question

1. OPS-042: does a 2 tile run now start within its promised time on whatever card is free, and on which card and region, at what cost?
2. PROTO-195: does a whole slide run of PathoSAM + HoVer-NeXt v1.2 on a small real tissue slide now return cells, and does the slide row show the count?

## Method

1. Signed in with `python3 scripts/agent_session.py --out` a scratchpad file, then called the API with the session cookie from a scratch Python script (not committed). Each run read `GET /api/me`, then `GET /api/projects/{id}/models` for the promise, then sent the same body the Run a model dialog sends (`slide_ids`, `scope` `slide`, `detector` `pathosam-hovernext` `v1.2`), then polled `/api/me/jobs` every 5 s and appended each change to a log file. The promise below is from the models route, which the dialog reads. The dialog text itself was not opened.
2. Before run 1, `modal container list --env main` showed no detector container. The only GPU pool container was another session's embedder on an H100 (`gpu pool run` lines with `family` `embedder` from 21:46 UTC), so the GPU pool's billing in that hour mixes both sessions. It is split by card below.
3. After each run, read the `gpu pool run` lines with `family` `detector-best` from `modal app logs parfocal-gpu-pool --env main --timestamps`, the run's stages from `GET /api/projects/{id}/model-runs/{run}`, `gpu_usage` and `job_steps` by SELECT, the result set and `GET /api/slides/{id}/result-sets`, which feeds the slide row.
4. Read Modal's hourly billing report for `main` (`modal.Workspace.from_context().billing.report(resolution="h")`) and the November summary before run 1 and after run 3.

## Results

### The three runs

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Slide | synthetic-zlib.ome.tiff (P03) | CMU-1-Small-Region.svs (P03) | Case ready (P01) |
| Job | bccac839 | f4471924 | 9559ce01 |
| Result set | 0cb7b691 | 7e2b20c6 | a0d59fd1 |
| Promise from the models route | `start_minutes` 24, `minutes_per_slide` 17 (not measured), 0 runs ahead, `queue_minutes` 0 | `start_minutes` 19, `minutes_per_slide` 1 (measured), 0 ahead | the same as run 2 |
| POST answered (UTC) | 21:53:20.3 | 21:54:29.2 | 21:59:26.2 |
| First poll not queued | 24 s | 18 s | 23 s |
| First stage started after the POST | 22.3 s | 11.9 s | 17.7 s |
| `wait` while queued | `gpu-busy` for the first poll or two, then null | the same | the same |
| Container | ta-01M8AB5W2FGX38FT8SJ2HFQ71R, cold, image banner 21:53:25 | the same container, still warm | ta-01M8ABH1B467JRPKB2ZRBAS2CR, cold |
| `gpu pool run` line | `A100-40GB`, `eu-west`, `CLOUD_PROVIDER_GCP` at 21:53:27 | `A100-40GB`, `eu-west`, GCP at 21:54:29 | `L4`, `eu-west`, GCP at 21:59:31 |
| `gpu_usage.gpu` and seconds | A100-40GB, 6.7 s | A100-40GB, 53.9 s | L4, 68.7 s |
| Tiles | 2 of 2 | 11 of 11 | 11 of 11 |
| Objects found by the model | 8 | 2,428 | 2,428 |
| Finished (UTC) | done 21:53:53.8, 33.6 s after the POST | failed 21:55:41.7, `run-cells-unstorable`, 72.5 s after the POST | done 22:01:01.1, 94.8 s after the POST |
| Result set | ready, `cell_count` 8 | failed, `run-cells-unstorable`, 0 cells | ready, `cell_count` 2,428 |
| Slide row list (`/api/slides/{id}/result-sets`) | ready, 8 cells | failed, `run-cells-unstorable` | ready, 2,428 cells |

Run 2's `job_steps`: `model-running` done with `{"ran": 11, "tiles": 11, "seconds": 53.9}`, `objects-placed` done with 2,428 cells typed, `ids-given` failed with no result, `result-set-added` pending. Run 1's and run 3's `ids-given` stored with `inherited` 0.

### Cost

Modal's hourly report for `main`, `parfocal-gpu-pool`, read at 22:02 and again at 22:03 UTC:

| Hour (UTC) | Card | Cost | Whose |
|---|---|---|---|
| 21:00 | A100-40GB | $0.1641 | runs 1 and 2 together, one container (no other A100 row in `gpu_usage` that hour) |
| 21:00 | L4 | $0.0067 | the first 29 s of run 3 |
| 21:00 | H100 | $1.0556 | the other session's embedder, not this check |
| 21:00 | A10G | $0.0251 | not this check, no detector line names an A10G |
| 21:00 | CPU, memory, egress for the whole app | $0.0209 | shared, not split |
| 22:00 | L4 | TODO, not itemised when read | the rest of run 3 |

So the measured GPU cost of this check is $0.171 so far (A100-40GB $0.164 plus L4 $0.007), plus the 22:00 hour L4 line still to read. An estimate of that line, not a measurement: run 3's container lived about 90 s after 22:00 including the 60 s scale-down, about $0.02 at $0.80 an hour. The November summary moved from credits used $12.37 to $12.69 during the check, which includes the other session.

## Interpretation

### OPS-042: met

A cold run on a 2 tile slide left the queue 24 s after the POST against a promised 24 min, with no region pin. Modal placed it on an A100-40GB in `eu-west` on GCP although L4 is first in the pool's list, and run 3 eight minutes later got an L4 in `eu-west`. So the first free card wins, as ADR 0440 (GPU pools take any card big enough) intends, and an A100 run costs about 2.6 times an L4 run for the same work. Each job stayed far below $1. The PROTO-168 promise read 24 min before the run and 19 min after, because `start_minutes` is the median of past waits, so it still overstates a start that now takes seconds.

### PROTO-195: not met on the named slide, met on the same image without stored cells

Run 2 on CMU-1-Small-Region.svs found the same 2,428 objects as the owner's empty run on Slide 1 (P02 of the workspace test, also 2220 by 2967, job 9bf7f362), so the model and the stages now work. The new seal also did its job: the set failed with a reason instead of closing ready with 0. But the cells were not stored. Run 3 on the same image in a slide with no stored cells stored all 2,428 cells and the slide row lists them.

The likely cause, a hypothesis from reads and not replayed: run 2's slide holds the seeded set "Cell typer v1" with 1,418 cells (numbers such as C314, C553 and C1172 were seen on 2026-11-24), but `slide_counters` has no `C` row for that slide. `ids-given` pairs run cells with those stored cells and keeps their numbers, then `reserve` hands out new numbers from 1, so a new cell gets a number an inherited cell already has and `binned` in `chunk_store.py` raises "appears twice", which `run_result_set.py` turns into `run-cells-unstorable`. Of the five `ids-given` steps in production, the two that recorded counts (runs 1 and 3) had `inherited` 0, the three older ones recorded no result, and run 2 is the only one on a slide with stored cells. The exact `ChunkError` text is not logged anywhere (TODO). The owner's Slide 1 has no stored cells and only a `T` counter, so a rerun there would probably store its cells as run 3 did, but the agent account is not a member of that workspace.

The row shows the failure as "Failed, run cells unstorable", because `failureText` in `apps/web/src/screens/jobs/model.ts` has no sentence for that code and replaces the dashes.

## Follow-ups

1. PROTO-195 needs a fix in this task: new cell numbers must start above every number already stored on the slide (or the seed must write the slide's `C` counter), and a test with a stored set whose numbers overlap the reserved range. A rerun on CMU-1-Small-Region.svs in P03 then closes the deployed clause.
2. Log the `ChunkError` message when a step fails with `run-cells-unstorable`, and give that code a sentence on the row.
3. `wait` read `gpu-busy` for the first seconds of a cold start with no detector container up. A reason such as "starting a GPU" would be truer.
4. `start_minutes` still promises 19 to 24 min from old waits. With any card allowed, the median of recent waits will fall, but the dialog keeps overstating until then.
5. TODO: read the 22:00 UTC hour L4 line for `parfocal-gpu-pool` to finish run 3's cost.

What the check left in the dev app: the ready result set 0cb7b691 (8 cells) on synthetic-zlib.ome.tiff, the failed set 7e2b20c6 on CMU-1-Small-Region.svs, the ready set a0d59fd1 (2,428 cells) on Case ready in P01, and the three jobs. The next reseed removes them.
