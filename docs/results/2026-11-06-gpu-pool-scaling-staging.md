# Result: the GPU worker pool adds containers with queue depth and stops at its cap

- Date: 2026-11-06
- Backlog: AIP-006 (GPU worker pool)
- Kind: check
- Environment: Modal environment `staging`, Starter plan, Modal client 1.6.3, Python 3.14 image from `debian_slim`, region not pinned. One ephemeral app, `parfocal-pool-scaling-check`, nothing deployed
- Data: none. The probe only sleeps and reports its container id and region

## Question

Does a pool built by `build_app` in `workers/ml/src/parfocal_ml/modal_pool.py` start more containers when more calls wait, stay within its `max_containers` cap and leave nothing running afterwards?

## Method

`uv run --package parfocal-ml modal run -e staging workers/ml/spike/pool_scaling.py` builds the detector good pool through the same factory as production, with `cpu_stand_in` swapping the T4 for a CPU container (256 MiB request, 512 MiB limit, one input per container, cap of 3, 2 s idle scale-down). It spawns one probe of 15 s, waits, then spawns six at once and counts distinct `MODAL_TASK_ID` values in the replies.

## Results

| Queue depth | Containers seen | Wall time (s) | Regions |
| --- | --- | --- | --- |
| 1 | 1 | 17.5 | eu-west |
| 6 | 3 | 34.1 | ap-south, eu-west |

Six calls on three containers took 34.1 s, about two rounds of 15 s, so the cap held and the extra calls queued. After the run `modal app list -e staging --json` showed the app `stopped` with 0 tasks.

Cost from `modal billing report --for today`: $0.00020497 for the app, and no other staging charge that day.

## Limits

One run, CPU stand-in only. GPU cold starts on T4 and L4 are in the [GPU serving spike](2026-11-02-gpu-serving-spike.md). Modal placed containers of one app in two regions, which is allowed while regions are not pinned.
