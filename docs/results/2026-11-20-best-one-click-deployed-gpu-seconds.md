# Result: a deployed Best click gets its outline from the server's PathoSAM ViT-L, warm in about 2 s, and a cold EU pool waited 6.5 minutes for a GPU

- Date: 2026-11-20
- Backlog: AISEG-024 (Best one-click outlines run PathoSAM ViT-L on the server)
- Kind: deployed check with cost
- Commit: `cf89e64a` (v0.27.1 as deployed on app.parfocal.eu)
- Environment: MacBook with Apple M4 and 24 GB, macOS 15.8.1, Playwright 1.65.1 with its headless Chromium shell build 1248, signed in as the agent test account. Modal environment `main`, apps `parfocal-api` and `parfocal-gpu-pool`, embedder pool on T4 with L4 as fallback, pinned to region `eu`
- Data: `test_065` in the seeded project "Vendor format robustness", nuclei picked from `packages/test-fixtures/model-results/test-065/cells.geojson`, no PHI

## Question

AISEG-024 waits for a deployed Best click on `test_065` that shows `data-encoder="server"`, for the best-outline smoke, for the cold and warm GPU seconds, and for the remaining 28 TNBC images. What does the deployed app do today, and what did the GPU calls cost?

## Method

1. Waited until `modal container list --env main` showed no `parfocal-gpu-pool` container, so the pool was cold.
2. A Playwright script with the saved agent session posted `POST /api/slides/{test_065}/embeddings/view` for a 512 by 512 view around one nucleus, following the waiting protocol of ADR 0404 (a GPU call answers waiting and is polled) until a 200 came. A second call on a neighbouring nucleus followed at once, on the warm pool. This is the same request the best-outline smoke makes, without its three minute retry.
3. In the viewer, the same script opened `test_065` centred on a third nucleus, pressed `s`, picked Best, clicked the nucleus and read the smart layer's attributes, then pressed Escape. It then picked Good on a fourth nucleus (see the PROTO-036 result of the same day).
4. Read the request lines of `parfocal-api` and the container lines of `parfocal-gpu-pool` with `modal app logs`, and the hourly cost with `modal billing report --for today -r h --tz local --show-resources` after the container had scaled down.
5. The repository's best-outline smoke (`apps/web/smoke/best-outline.spec.ts`) needs `PARFOCAL_SMOKE_EMAIL` and `PARFOCAL_SMOKE_PASSWORD`, which this check does not hold. Its run in the v0.27.1 deploy workflow (GitHub Actions run 44725184791, job "browser-smoke") was read instead.

Three Best embeddings were asked in all, plus one `embeddings/warm` call from the viewer.

## Results

| Call | Pool | Client time | Server request lines | Encoder header |
|---|---|---:|---|---|
| Best embedding, first | cold, waited for an EU GPU | 407,715 ms | eight 202 answers of about 45.4 s each, then 200 after 43.2 s | `pathosam-vit-l-histopathology-fp32`, 2,097,152 bytes |
| Best embedding, second | warm | 2,265 ms | 200 after 2.15 s | same, 2,097,152 bytes |
| Best click in the viewer | warm | 7,219 ms from click to ready outline, including the first download of both ViT-L decoders | `embeddings/warm` 204 after 177 ms, then `embeddings/view` 200 after 1.99 s | same |
| Smoke in the v0.27.1 deploy, 11:13 UTC | cold | test 38.8 s | one 200 after 33.7 s, no 202 | asserted by the smoke |

The viewer's smart layer after the Best click read `data-encoder="server"`, `data-phase="ready"`, one live proposal and `data-confidence="1.00"`. The outline lay on the clicked nucleus.

| GPU pool container | First container line (CET) | First answer (CET) | Container line to answer |
|---|---|---|---:|
| `ta-01M7WAJK676VV1FN47J3SWKNMR`, started by the deploy smoke | 12:13:29 | 12:13:56 | 27 s |
| `ta-01M7WBD9PQK8K551W85CXVCMVR`, started by this check | 12:28:04 | 12:28:22 | 18 s |

For this check's first call, `parfocal-gpu-pool` logged "Function 'embedder' … is waiting to be scheduled on [GPU_T4, GPU_L4] worker", with Modal's hint that relaxing the `region=eu` requirement may schedule faster, from 12:22:40 until the container started at 12:28:04. The call was sent at 12:21:35, so it waited about 389 s for a GPU.

Modal billing for `parfocal-gpu-pool` in the hour from 12:00 CET, read at 12:36 CET:

| Resource | Dollars |
|---|---:|
| T4 (the deploy smoke's containers, the embedder and any typer or view map container it started) | 0.08443552 |
| L4 (this check's container, the only L4 that hour) | 0.09097703 |
| CPU, both containers | 0.00287498 |
| Memory, both containers | 0.00821863 |
| Network egress, both containers | 0.00130918 |

At Modal's listed $0.80 an hour, the L4 figure is about 409 s of L4 time: 18 s of start and first encode, the warm calls, and the 300 s scale-down window of the interactive pool. If Modal adds a region multiplier for `eu`, which `modal billing rates` does not show, the seconds are fewer. The `parfocal-api` app costs about $0.02 an hour whether or not a GPU call runs.

## Interpretation

- Best on the deployed app takes its outline from the server's ViT-L embedding and the ViT-L decoder in the browser, which is what the task asks.
- A warm Best embedding takes about 2 s on the server. A cold container needs 18 to 27 s from its first line to the first answer. On a cold pool the wait for an EU GPU dominated, 389 s today against about 7 s for the deploy smoke an hour earlier (its request started at 12:13:22 and the container's first line came at 12:13:29).
- Each cold Best session costs roughly one 300 s scale-down window of GPU time plus the start. This check's L4 container cost $0.091, and the whole deploy smoke's T4 time cost $0.084. This check's GPU calls cost $0.091 of L4 plus its share of under $0.013 of CPU, memory and egress.
- The best-outline smoke passed on a cold EU pool in the v0.27.1 deploy.

## Follow-ups

- Not done here: the remaining 28 TNBC images of the ViT-L against ViT-B comparison. The ViT-L run on the Mac's CPU ran out of memory on 2026-11-19, and another agent is building on the same Mac now, so it is too heavy for this check. It needs a Modal GPU run or a quiet Mac. `TODO`.
- `TODO` peak GPU memory of the ViT-L encode on a T4 or L4, which ADR 0202 (the v1 model line-up per tier) asks for. The pool logs no memory line.
- The first call fell back from T4 to L4. Whether the T4 was missing or busy is not in the logs.
