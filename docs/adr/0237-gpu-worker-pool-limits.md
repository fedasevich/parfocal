# 0237. GPU worker pool: one Modal function per model family, capped containers and scale to zero

- Date: 2026-11-06
- Status: Proposed
- Deciders: agent doing AIP-006 (GPU worker pool), for the owner to confirm
- Backlog: AIP-006 (GPU worker pool). Builds on [ADR 0003](0003-pilot-platform-architecture.md) (pilot platform architecture), [ADR 0150](0150-gpu-serving-on-t4-and-l4-class-cards.md) (GPU serving on T4 and L4 class cards) and [ADR 0202](0202-v1-model-line-up-per-tier.md) (v1 model line-up per tier). Feeds AINUC-001 (detector runner) and SEC-026 (isolated parsing of uploaded files)

## Context

ADR 0003 puts GPU work in Modal functions per model family that start cold, and ADR 0150 limits them to T4 and L4 class cards with a 300 s idle scale-down for interactive embeddings. The project runs on $30 a month ([ADR 0151](0151-standing-approval-for-production-within-30-dollars.md)), so a pool that never scales down or fans out too wide can spend the month in hours. The limits need one home that tests can read without a Modal account.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Limits as plain data in `parfocal_ml.gpu_pool`, turned into Modal options by a thin factory in `parfocal_ml.modal_pool` (chosen) | |
| Limits written inline in each `@app.function` decorator, as the spike did | Modal keeps the autoscaler settings inside its deploy closure, so tests could not read them back, and every family would repeat the same numbers |
| One shared GPU function that loads any model | A whole-slide L4 job and a T4 embedding would share a container size and cap, and every cold start would pay for the largest model |
| Keeping a warm container (`min_containers=1`) for the embedder | ADR 0003 rejects warm GPUs on cost. The API pre-warms instead |

## Decision

1. Five pools, one per model family and tier in ADR 0202: detector best and typer best on the L4, detector good, typer good and the interactive embedder on the T4.
2. Every pool has `min_containers=0` and `buffer_containers=0`. Batch pools scale down after 60 s idle, the embedder after 300 s.
3. Batch pools take one input per container and the embedder four. Caps are 2 containers for each detector pool and 1 for the others, at most 4 per pool.
4. Container memory is a request and a hard limit, at most 16 GiB. The model's GPU memory budget must fit the card, 16 GB on the T4 and 24 GB on the L4 or A10G, as ADR 0150 rule 3 says.
5. Batch calls time out after an hour and embedding calls after 60 s.
6. All pools at their cap together must cost at most $5 an hour at the ADR 0150 prices. The current pools come to $4.76. `validate_pools` refuses an app that breaks any of these, before Modal sees it.
7. The API still never imports Modal. Only `parfocal_ml.modal_pool` does.

## Consequences

- Seven GPU containers at most across all pools keep a runaway queue to about $5 an hour, but a busy pilot day queues jobs instead of fanning out. Raising a cap is a one-line change that the spend test checks.
- Each family answers only `probe` calls until its runner lands, starting with AINUC-001.
- SEC-026 can add a CPU parser pool through the same factory with `block_network` and a tighter memory limit.
- The staging check in [the scaling result](../results/2026-11-06-gpu-pool-scaling-staging.md) saw 1 container at queue depth 1 and 3, the cap, at depth 6.
- TODO: the 60 s batch scale-down is a guess. Measure it against cold starts once a real whole-slide job runs.
