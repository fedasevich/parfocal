# Result: interactive embeddings beside a whole-slide job on Modal GPUs

- Date: 2026-11-02
- Backlog: STACK-027 (GPU inference serving)
- Kind: spike
- Commit: 738e9ce (the runs used the same code before `ruff format`)
- Environment: Modal environment `dev`, Starter plan, NVIDIA T4, region not pinned (Modal placed the embedding container in `eu-west` once and `us-east` twice, all on AWS), image Debian slim with Python 3.12, torch 2.9.0+cu128 and `segment-anything` 1.0. Client was the owner's MacBook on a home connection in Europe, Modal client 1.6.3
- Data: random tiles generated on the GPU from a seed, no slide data and no PHI

## Question

Can a pre-warmed Modal GPU container serve an interactive embedding request within 1 s while a whole-slide job runs on another GPU, as [ADR 0003](../adr/0003-pilot-platform-architecture.md) (pilot platform architecture) assumes, and how long is the cold start?

## Method

`uvx modal run -e dev workers/ml/spike/gpu_serving.py` runs one ephemeral app with two GPU functions on T4, the cheapest Modal GPU.

1. `Embedder` is a class with `scaledown_window=300`, the "about 5 idle minutes" of ADR 0003. At container start it builds the SAM ViT-B image encoder with random weights (`sam_model_registry["vit_b"](checkpoint=None)`, the same architecture and cost as the real weights, so no download), moves it to the GPU in float16 and runs one warm-up pass. Each request encodes one 1024 by 1024 tile into a 256 by 64 by 64 embedding.
2. The client's first call is the cold start and also the pre-warm. It is timed from the client, so it includes scheduling, container start, the model load and one request.
3. The client spawns `slide_job`, which loads the same encoder in its own container and encodes tiles in a loop for 120 s. The client waits until the job reports that it is running.
4. While the job runs, the client sends 20 rounds of five calls to the warm container: an embedding returned as float16 (2,097,152 bytes), the same with no payload, the same quantised to int8 (1,048,576 bytes), an empty call, and empty calls returning 1.9 MB and 2.2 MB of random bytes.
5. Every warm call's finish time is checked against the job's running window. All runs ended with the app stopped and no container left.

Run 1 built the image and failed on a result type, and is not counted. Run 2 had only the float16 embedding calls. Runs 3 to 5 had the steps above, with the int8 calls only in run 5. In run 3 the job's container waited about 117 s for a T4, so none of its warm calls overlapped the job. Its no-payload and empty calls are kept as a baseline with no job running.

## Results

Cold start, client clock from first call to reply, one request included.

| Run | Region | Round trip (s) | Model load in container (s) |
| --- | --- | --- | --- |
| 2 | not recorded | 12.07 | 6.80 |
| 3 | eu-west | 15.86 | 6.97 |
| 4 | us-east | 40.49 | 6.83 |
| 5 | us-east | 12.26 | 6.72 |

The whole-slide job went from spawn to running in 17.4 s (run 4) and 10.7 s (run 5), loaded its model in 5.8 to 6.6 s and encoded 814 to 834 tiles in 120 s, about 6.9 tiles a second on one T4.

Warm calls while the job ran, in seconds, 20 calls each.

| Call | Run | Min | Median | p95 | Max | Calls inside the job window |
| --- | --- | --- | --- | --- | --- | --- |
| Embed, float16 payload | 2 | 1.404 | 1.434 | 1.515 | 1.529 | 20 of 20 |
| Embed, float16 payload | 4 | 1.419 | 1.557 | 1.733 | 1.902 | 40 of 40 with the next row |
| Embed, no payload | 4 | 0.263 | 0.273 | 0.294 | 0.306 | |
| Embed, float16 payload | 5 | 0.791 | 1.514 | 1.668 | 1.688 | 60 of 60 with the next two rows |
| Embed, no payload | 5 | 0.244 | 0.260 | 0.285 | 0.289 | |
| Embed, int8 payload | 5 | 0.364 | 0.391 | 0.438 | 1.101 | |
| Embed, no payload, no job running | 3 | 0.335 | 0.356 | 0.424 | 0.431 | 0 of 40 |
| Empty call, no job running | 3 | 0.241 | 0.249 | 0.259 | 0.281 | |
| Empty call | 4 | 0.228 | 0.235 | 0.255 | 0.287 | |
| Empty call | 5 | 0.232 | 0.254 | 0.271 | 0.279 | |
| Empty call returning 1.9 MB | 4 | 0.292 | 0.388 | 1.008 | 1.448 | |
| Empty call returning 1.9 MB | 5 | 0.312 | 0.354 | 0.419 | 0.449 | |
| Empty call returning 2.2 MB | 4 | 0.621 | 1.330 | 1.392 | 1.478 | |
| Empty call returning 2.2 MB | 5 | 0.633 | 1.336 | 1.423 | 1.570 | |

GPU time for one embedding inside the container, across runs 4 and 5: median 0.14 to 0.18 s, max 0.225 s.

Cost: `modal billing report --for today` shows $0.25 metered for all five runs ($0.24 ephemeral apps, $0.01 egress), all covered by the free credits. Billed $0.00.

## Interpretation

- The pre-warmed container serves an embedding within 1 s while a whole-slide job runs, as long as the reply stays under about 2 MB: median 0.26 to 0.27 s with no payload and 0.39 s with an int8 embedding, p95 at most 0.44 s. The job ran in its own container, and the warm calls were no slower than run 3's calls with no job running, so separate functions do replace the priority gate.
- A float16 SAM ViT-B embedding is exactly 2 MiB and misses the target from this client, at a median of 1.43 to 1.56 s. The empty calls show why. Below 2 MB a reply costs about 0.1 s more than an empty call, and above it about 1.1 s more, whatever the GPU does. This looks like Modal's large-result path, which is an inference from these numbers and not something Modal's docs were checked for.
- The cold start is 12 to 16 s in three runs and 40 s in one. About 7 s of it is torch import, model build and the warm-up pass inside the container, and the rest is scheduling and container start. A T4 can also take minutes to become free, as in run 3. So the pre-warm on tool activation is needed, and a doctor who clicks before it lands waits about 12 s or more.
- Assumption: the client was a home connection, and the browser would reach the function through the Worker and FastAPI, which adds hops this spike did not measure.

## Follow-ups

- AISEG-008 (server embedding service) plans a float16 embedding per tile. It should keep each reply under 2 MB, by int8 quantisation or by writing embeddings to R2 and returning a key. TODO: check that the SAM decoder's masks stay the same with int8 embeddings before choosing.
- The cold-start budget ADR 0003 left open is now measured for GPU functions. TODO: the 40 s outlier and the 117 s wait for a T4 need more samples before a budget is set.
- No ADR, because the measurements confirm the ADR 0003 default.
