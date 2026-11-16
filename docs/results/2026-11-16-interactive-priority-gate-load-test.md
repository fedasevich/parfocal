# Result: interactive embeddings through the priority gate while a stand-in whole-slide job runs

- Date: 2026-11-16
- Backlog: AIP-007 (interactive priority gate)
- Kind: load test
- Commit: e0a9691a (run 2). Run 1 used the same code with the stand-in depth calibrated in each container
- Environment: the owner's MacBook, Apple arm64, 10 CPUs, macOS (Darwin 24.6.0), Python 3.14.10, numpy with one BLAS thread per process. Other agents shared the machine: the load average was 14.6 during run 1, 8.8 when run 2 started and 4.7 when it ended. No GPU, no Modal, no network
- Data: generated grey tiles and a random-weight numpy stand-in encoder, no slide data, no real weights and no PHI

## Question

Does an interactive embedding request finish within 1 s from a pre-warmed container while a whole-slide job runs, the target of STACK-027 (GPU inference serving), when it goes through `parfocal_ml.priority_gate`? Does the separate pool matter, compared with the same request sent into the job's queue? Where does one embedder container stop meeting the target as clients are added?

The pass rule was fixed before run 1: in every gated arm with at most 4 clients (the embedder's `max_inputs`), p95 and max under 1 s measured at the client including queue time, and every call inside the job's running window.

## Method

`uv run --package parfocal-ml python -m parfocal_ml.gate_load --out FILE` from `workers/ml`, with the defaults: 20 calls per client, a 45 s job, client sweep 1, 2, 4 and 8, three first-call rounds and a stand-in encode target of 0.14 s, the T4 GPU time per SAM ViT-B embedding in [the GPU serving spike](2026-11-02-gpu-serving-spike.md).

1. Each Modal container is stood in for by one spawned OS process with a request queue, so the embedder and the job run on separate processes as they would on separate GPUs. Inside a process a lock lets one encode run at a time, the way one GPU serves its inputs, and a thread pool takes up to `max_inputs` calls.
2. The stand-in encoder patchifies a 1024 by 1024 input into 4096 tokens and runs 1024-wide matrix products with tanh, then projects to 256 by 64 by 64. Run 2 calibrated the number of layers once in a separate process (8) and gave every container that depth. The measured encode time per container was 0.09 to 0.19 s.
3. Gated arm: `InteractiveGate.activate(Device.SLOW)` sends the warm call, which starts the embedder process on its first use like a scale-from-zero container. The fake whole-slide job is one `detect` call to the `detector_good` pool that encodes tiles in a loop for 45 s. Once it runs, client threads send `embed` calls back to back through `gate.request`. Each call reads a tile, encodes it, packs it to float16, writes the 2,097,152 bytes to an in-memory store through `tile_key` and replies with the key only.
4. Control arm, no gate: one container with `max_inputs` 1 and the job's tiles in its queue, kept 8 deep by a feeder, and one client's calls joining the same queue.
5. Baseline: one client, warm embedder, no job.
6. First call: a new embedder process per round, either called at once (cold) or called after the warm call was answered.

## Results

Run 2, seconds at the client.

| Arm | Clients | Calls | Min | Median | p95 | Max | Calls inside the job window | Job tiles | Passes |
|---|---|---|---|---|---|---|---|---|---|
| No job running | 1 | 20 | 0.105 | 0.117 | 0.124 | 0.132 | | | |
| Gated | 1 | 20 | 0.242 | 0.384 | 0.425 | 0.482 | 20 of 20 | 353 | yes |
| Gated | 2 | 40 | 0.207 | 0.454 | 0.600 | 0.614 | 40 of 40 | 363 | yes |
| Gated | 4 | 80 | 0.451 | 0.881 | 1.113 | 1.373 | 80 of 80 | 307 | no |
| Gated | 8 | 160 | 0.170 | 1.913 | 2.394 | 2.580 | 160 of 160 | 255 | no |
| One shared queue, no gate | 1 | 20 | 0.928 | 1.186 | 1.409 | 1.523 | 20 of 20 | 174 | no |

First call, three rounds each.

| First call | Min | Median | Max |
|---|---|---|---|
| Cold, process start and model build included | 1.230 | 1.254 | 1.275 |
| After the warm call | 0.108 | 0.108 | 0.114 |

The embedder process was ready 1.24 to 1.86 s after the warm call was sent.

Run 1 calibrated the depth in each container under a load average of 14.6, so the embedder got 2 layers and the job 6, and its arms did unequal work. It is reported, not used: gated medians 0.326, 0.136, 1.084 and 0.701 s and p95 0.483, 0.246, 1.423 and 0.859 s for 1, 2, 4 and 8 clients, the control median 0.698 s and p95 0.944 s, and the no-job baseline median 0.162 s.

## Interpretation

- The STACK-027 target holds through the gate. One interactive client while the job ran had a worst call of 0.48 s, and every call finished inside the job's window. Two clients stayed under 0.62 s.
- The gate matters. The same single client in the job's queue had a median of 1.19 s and a worst of 1.52 s, with only 8 job tiles ahead of it. A real job keeps a whole slide of tiles queued, so this control is generous to the shared queue.
- The pre-declared rule fails at 4 clients sending back to back: p95 1.11 s and max 1.37 s. That is the capacity of one serial embedder, not waiting behind job tiles: with 4 callers each call waits for about 3 others. Back to back calls are a stress test. A person clicking misses the cache only when they move to a new tile.
- Gated calls with a job running were about 3 times slower than with no job (0.38 against 0.12 s median), because both processes share this Mac's CPU and memory. On Modal they run on separate GPUs, so this is an assumption that the local figure overstates the interference.
- The pre-warm saves about 1.15 s locally. Locally a cold start is only a process start and a model build. The spike measured 12 to 16 s on Modal, with one sample at 40 s, so the warm call matters much more there.
- Not measured here: Modal network time, GPU time and the real PathoSAM encoder. The spike measured a warm Modal call at a median 0.26 s with no payload. The gate replies with a key and not the embedding, which keeps the reply under the 2 MB limit of ADR 0150 (GPU serving on T4 and L4 class cards). These numbers and the spike's should not be added together as if one run measured both.

## Follow-ups

- AIP-021 (pre-warm trigger from a slow device through the API) wires the trigger: the web's slow-device check, an API route and the Modal client that the API lacks, plus the real `embed` runner.
- Decision XXX in `docs/decisions.md` asks whether one embedder container is enough. A second one would take the worst case of all pools to 5.35 USD an hour, over the 5 USD cap that `validate_pools` enforces.
- TODO: rerun on Modal with the real encoder once AIP-021 lands.
