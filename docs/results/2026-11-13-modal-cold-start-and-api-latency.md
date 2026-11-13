# Result: Modal cold start and API latency in production

- Date: 2026-11-13
- Backlog: STACK-019 (web framework)
- Kind: baseline
- Commit: the deployed API, `parfocal-api` version v4 from commit `2ca8574`
- Environment: a MacBook on a home connection in Vienna, Cloudflare's Vienna edge (`cf-ray` ending in `VIE`), the Worker at `app.parfocal.eu`, Modal environment `main` with the web endpoint at `us-east`. Web function settings: 512 MiB to 2 GiB of memory, `min_containers` 0, `max_containers` 4, `scaledown_window` 300 s, no `region=` pin and no `@modal.concurrent`, so each container serves one request at a time
- Data: `GET /api/health`, which answers `{"status":"ok"}` with no database work, and the API's own request log. No user data

## Question

How long does the first request take after the API has scaled to zero, and how long do warm requests take, so [ADR 0003](../adr/0003-pilot-platform-architecture.md) (pilot platform architecture) can replace its TODO for API latency and Modal cold-start budgets?

## Method

Read only, as a visitor would, with no deploy and no `modal run`.

1. Warm latency: 30 `curl -w` requests in a row to `https://app.parfocal.eu/api/health` and 30 to `https://fedasevich--parfocal-api-web.us-east.modal.run/api/health`, reading connect, TLS, time to first byte and total. "Server" below is time to first byte minus TLS done, so it leaves out this Mac's connection setup.
2. Cold start: poll `modal container list -e main --json` every 15 s until no `parfocal-api` container runs, then time one request to `app.parfocal.eu/api/health` at once, then three warm ones. Repeated three times.
3. Modal's side: `modal app logs parfocal-api -e main --since 24h --show-container-id --timestamps`. Modal writes a line per request with `duration` (from Modal taking the request to the answer, boot and queueing included) and `execution` (the container's part). The app writes `duration_ms` (its own handler time). The first request on a new container shows its boot as `duration` minus `execution`.

The scripts live only in the session scratchpad. They are `warm.py`, `cold.sh` and `modalside.py`, each a few lines of `curl` or JSON parsing.

## Results

Warm, 30 requests each, in milliseconds:

| Path | Status | Connect p50 | Server min | Server p50 | Server p90 | Server max | Total p50 | Total p90 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `app.parfocal.eu/api/health` through Cloudflare | 200 | 13.0 | 144.4 | 155.7 | 473.7 | 626.7 | 192.3 | 511.3 |
| Modal URL direct | 401 | 116.2 | 118.1 | 121.5 | 131.7 | 170.7 | 357.7 | 367.3 |

The direct Modal URL answers `401 modal-http: missing credentials for proxy authorization` from Modal's proxy, because the endpoint has `requires_proxy_auth`. Those requests never reach a container, so that row only shows the network from Vienna to Modal's ingress, about one transatlantic round trip of 116 ms.

Inside the container `/api/health` takes 0.5 ms (median of 50 log lines, 2.9 ms at most).

Cold start, first request after the API had scaled to zero:

| Run (UTC) | Time to first byte at this Mac | Modal `duration` | Modal `execution` | Next three warm requests |
|---|---:|---:|---:|---|
| 21:20:53 | 12.42 s | 12.1 s | 210 ms | 0.40, 0.71 and 0.72 s |
| 21:26:44 | 7.19 s | 6.73 s | 38 ms | 0.23, 0.65 and 0.22 s |
| 21:32:58 | 9.05 s | 8.51 s | 15 ms | 0.19, 0.52 and 0.20 s |

Cold containers in the 24-hour log, started by real traffic, first request: Modal `duration` 6.73, 8.85 and 5.87 s, with `execution` of 61, 628 and 39 ms. The 628 ms one included the first database work.

Modal's `execution` minus the app's own time differs by container. On the container that served the warm runs it was a median 11.8 ms over 57 requests. On the containers from the three cold runs it was about 208, 37 and 15 ms, and on other containers in the log 21.5, 72.8, 90.2 and 108.3 ms.

## Interpretation

- A cold start costs 6 to 12 s before the first byte, 7.2 to 12.4 s in the three runs from this Mac. Almost all of it is Modal starting the container and importing the app, not the request. Anyone who opens the app after five quiet minutes waits that long.
- Warm, a request with no database work still takes about 156 ms after TLS from Vienna. The app spends 0.5 ms of it. The rest is the path from Cloudflare's Vienna edge through the Worker to Modal's ingress in US East and back, so from Europe no warm API call can be faster than about 150 ms while the API runs in the US.
- The 90th percentile of 474 ms on the Cloudflare path, and the 0.4 to 0.7 s warm requests after the first cold run, came partly with containers whose Modal overhead was 100 to 200 ms instead of 12 ms. Not all of it: after the third cold run one warm request took 0.52 s at this Mac while Modal logged 37 ms, so part of the tail is on the Cloudflare and transatlantic path. Assumption, not verified: with no region pin Modal placed those containers farther from its US East ingress. The log does not say where a container runs.
- With no `@modal.concurrent`, one container serves one request at a time. A page that sends ten requests at once makes Modal start more containers, up to four, and each new one pays the cold start. The log shows that after both deploys on 2026-11-13.

## Budgets

These are targets chosen from the numbers above, not measurements. They are the budgets [ADR 0003](../adr/0003-pilot-platform-architecture.md) records in its 2026-11-13 amendment.

| What | Budget | Measured today |
|---|---|---|
| App time of a read with database work, warm container | p50 under 50 ms, p95 under 250 ms | 20 to 50 ms on warm containers (see the [Neon region result](2026-11-13-neon-region-from-modal.md)) |
| A warm API call as a user in Europe sees it | p50 under 300 ms, p95 under 800 ms | `/api/health` p50 192 ms, p90 511 ms |
| First request after scale to zero | under 15 s, with a loading state on screen after 1 s | 5.9 to 12.4 s |
| A bulk write of 10,000 shapes | under 5 s, as the [annotation bulk latency result](2026-10-18-annotation-bulk-latency.md) already set | not measured in production |

## Follow-ups

- [ADR 0003](../adr/0003-pilot-platform-architecture.md) amended with the budgets and the cold-start figure.
- Recommendation only, nothing changed: add `@modal.concurrent` to the web function so one container takes many requests, which cuts how often a burst starts new containers and pays the cold start.
- Recommendation only: `min_containers=1` would remove the cold start but keeps a container running all the time, which the rule that nothing runs all the time in production rules out for now.
- Recommendation only: log `MODAL_REGION` at container start so the placement assumption above becomes a fact.
- TODO: rerun the warm series from a US location to separate the transatlantic part from Modal's own overhead.
