# Result: the API's first call after idle

- Date: 2026-11-17
- Backlog: OPS-028 (the API answers its first call after idle in under 3 s)
- Kind: measurement
- Commit: before is Modal app `parfocal-api` version v6 in environment `main` (commit 68ef526). The change is the OPS-028 commit on top of 5cdc4617
- Environment: production `app.parfocal.eu`, Modal Starter, web function at 0.125 core default with 512 MiB requested, `min_containers` 0, `scaledown_window` 300 s, Python 3.14, Modal client 1.6.3. Client was the owner's MacBook on a home connection in Europe
- Data: `GET /api/status`, which reads the maintenance row and holds no tenant data

## Question

Where do the roughly 10 s of the first call after idle go, and does a Modal memory snapshot bring it under 3 s at no monthly cost?

## Method

A script polled `modal container list -e main` every 20 s until no `parfocal-api` container was running, then timed one `curl` of `https://app.parfocal.eu/api/status` (cold) and a second one at once (warm). Waiting for zero containers is stricter than waiting 300 s, because other agents used production all morning and kept it warm. The Modal request log of the same call gives Modal's duration and the handler's execution time.

Local profiling with `python -X importtime -c "import parfocal_api.app"` on the loaded Mac took 8.6 to 27.7 s, so it only ranks the libraries: FastAPI and its routing, SQLAlchemy, geoalchemy2 pulling in shapely and numpy, httpx2, pydantic and PyJWT, plus the API's own modules. `create_app` took a further 2.1 to 3.2 s there.

## Results

| Sample | Time (UTC) | Idle wait | Cold total | Warm total | Modal duration | Handler execution |
| --- | --- | --- | --- | --- | --- | --- |
| Before 1 | 2026-11-17 09:13:15 | 680 s | 9.24 s | 0.57 s | 8.73 s | 63 ms |
| Before 2 | 2026-11-17 09:19:17 | 280 s more | 9.10 s | 0.59 s | not read | not read |

The third before sample could not be taken: production stayed warm for the following hour because other agents kept using it, and the script gave up after 3,600 s.

In sample 1 the handler, including its database query, took 63 ms of the 8.73 s Modal reported. So about 8.7 s is container start, Python imports, `create_app` and the lifespan's `require_row_security` query, which also wakes Neon after its own 5 idle minutes. TLS connect from the client was 17 to 22 ms.

### With the memory snapshot (Modal app v19, commit b6463e8)

The snapshot change was deployed as function `web-eu` (region eu, routing region eu-west). From 19:26 to 19:38 UTC each sample stopped the running web container with `modal container stop`, waited until it was gone (and from sample 5 on a further 10 s), then timed one cold and one warm `curl` of `/api/status`. Neon was warm in these samples because other agents and the samples themselves kept it busy, so they leave out a Neon wake. Server-Timing `app` is the handler.

| Sample | Curl start (UTC) | Kind | Worker | Status | Cold total | Modal duration | Server-Timing app | Warm total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 19:26:51 | created snapshot | AWS eu-west | 200 | 7.33 s | 7.06 s | 142 ms | not taken |
| 2 | 19:28:06 | created snapshot | GCP eu-west | 200 | 15.36 s | 15.1 s | 97 ms | 0.43 s |
| 3 | 19:28:45 | restored | GCP eu-south | 500 | 24.76 s | 24.4 s | none | 0.42 s |
| 4 | 19:29:51 | restored | Azure eu-west | 200 | 4.44 s | 4.30 s | 301 ms | 0.51 s |
| 5 | 19:35:14 | restored | Azure eu-west | 200 | 2.93 s | 2.70 s | 58 ms | 0.34 s |
| 6 | 19:35:46 | created snapshot | AWS eu-west | 200 | 9.88 s | 9.54 s | 739 ms | 0.40 s |
| 7 | 19:36:26 | created snapshot | Azure eu-west | 200 | 2.67 s | 2.38 s | 293 ms | 0.32 s |
| 8 | 19:37:24 | restored | Azure eu-west | 200 | 4.37 s | 4.08 s | 60 ms | 0.37 s |

A ninth try met a container another agent had just started and answered warm in 0.35 s, so it is left out.

What the samples show:

- Restores took 2.93, 4.44 and 4.37 s. They are faster than the 9.1 to 9.2 s before the snapshot but still over 3 s.
- Modal makes a snapshot per worker type. Its docs say a CPU function needs about 6 snapshots for full coverage, so the first several cold starts after every deploy create one instead of restoring. Creating took 2.4 to 15.4 s depending on the cloud. The lead deployed 9 times on 2026-11-17 alone, so on such a day most cold starts are creations.
- In sample 8 the curl started at 19:37:23.8, Modal logged the restore at 19:37:26 and the handler finished at 19:37:28.15 in 60 ms. In sample 5 it was 19:35:14.0, 19:35:15 and 19:35:16.95. So 1 to 2.5 s go to Modal placing the container before the restore starts, and the restore plus `serve()` and the lifespan take about 1.5 to 2 s.
- Sample 3 returned a 500 after 24.4 s with no application log line, on a restore in GCP eu-south. The same container answered the next call in 178 ms. It did not recur in the later restores. TODO: watch for it in the after samples. If it recurs, it is a Modal restore problem to report to Modal.

### Where the restored startup spends its time

`create_app` still imported modules that the snapshot did not hold: asyncpg and SQLAlchemy's asyncpg dialect, which `create_engine` loads, the httpx2 transport stack (httpcore2, h11, truststore), the anyio asyncio backend, `encodings.idna` and the thread pool executor. Locally, with the API's modules preloaded, `create_app` took 0.10 s and 92% of that was these imports. With them preloaded too it took 0.03 s and imported nothing new, and neither did the lifespan's database connect. The web container runs on 0.125 of a core, so the saving there is larger than on the Mac.

### After the second change (Modal app v21, commit cd3263c)

Taken from 20:08 to 20:11 UTC by the same script. App created and ready are the `parfocal.api.startup` log times. The millisecond fields of those lines were redacted by the log scrubber's allowlist, which the third commit fixes, so the split below uses the line timestamps.

| Sample | Curl start (UTC) | Kind | Worker | Status | Cold total | Restore logged | App created | Ready | Warm total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | 20:08:44.9 | created snapshot | AWS eu-west | 200 | 6.86 s | not read | 20:08:51.62 | 20:08:51.70 | 0.47 s |
| A2 | 20:09:20.3 | restored | AWS eu-west | 200 | 2.18 s | 20:09:21 | 20:09:22.27 | 20:09:22.35 | 0.23 s |
| A3 | 20:10:19.1 | restored | AWS eu-north | 200 | 6.39 s | 20:10:21 | 20:10:24.59 | 20:10:25.16 | 0.50 s |
| A4 | 20:10:52.5 | restored | Azure eu-west | 200 | 3.99 s | 20:10:54 | 20:10:56.04 | 20:10:56.26 | 0.60 s |

A fifth try met a container another call had just started and answered in 0.73 s, so it is left out.

- Only one of three restores was under 3 s, so the task's bar is not met.
- The app's own part is now small. The lifespan, which is the database connect and the row security check, took 80, 570 and 220 ms. The 570 ms was on AWS eu-north, which is farther from Neon in Frankfurt.
- The rest is Modal. Placing the container took 1 to 2 s from the curl start to the restore line, and the restore up to the app created line took 1.3 to 3.6 s. Neither can be cut in the app at no cost. Region `eu` lets Modal place the container in eu-north and eu-south, and narrowing it costs more.
- No call returned a 500 after about 25 s after this deploy. Both such 500s, at 19:29:10 and at 19:36:44 (the v0.15.0 post-deploy health check), came within seconds of a `modal container stop` this task ran, and Modal attributed them to no container. Stopping a container also failed other agents' calls in flight on it, such as five calls at 19:29:51 after 3.27 s and one at 20:09:48 after 4.69 s. So the 500 came from this measurement method, not from a restore. Forced stops should not run while a deploy check runs.
- Owner question 145 in `docs/decisions.md` (whether the API keeps one container warm) asks whether to pay for a warm container.

The plan for these samples was: Discard any sample whose container log says "Creating CPU memory snapshot", and take at least three restores. Read the `parfocal.api.startup` lines of each container: `web app created` gives `serve_ms` and `create_app_ms`, and `web ready` gives `lifespan_ms`, which is the database connect and the row security check. Their millisecond timestamps against the curl start split Modal's placement and restore from the app's own startup. Take one sample after more than 5 idle minutes of the whole app, so Neon is suspended too.

## The change

The web function sets `enable_memory_snapshot=True` and runs on the app image plus one environment variable, `PARFOCAL_PRELOAD=web`. With that variable set, `parfocal_deploy.modal_app` imports `parfocal_api.app` and the other modules `serve()` needs at module scope. Modal takes the snapshot after the module import and before it calls `serve()`, so restored containers skip the imports. `create_app()` still runs after restore, because it reads the secrets and builds the database engine and HTTP clients, none of which belong in a snapshot. Ingest and the event sweep do not set the variable and are unchanged. Memory snapshots cost nothing extra on Modal, and `min_containers` stays 0.

Lazy imports and a lighter web image were not built. A restored snapshot already holds the imported modules, so making them lazy would move their cost to the first request that needs them. A separate web lock would add a second image to keep in step for a pull that Modal's lazy image loading mostly hides. Both are worth doing only if the after samples stay over 3 s, and then the next target is `create_app` and the lifespan query.

The second change adds the modules `create_app` and the first connect still loaded to the web preload, so they land in the snapshot too, and logs the startup phases under `parfocal.api.startup`. It builds no SSL context or client before the snapshot, because Modal's docs warn that random state captured in a snapshot repeats on every restore. Still at no monthly cost, and `min_containers` stays 0. Not changed: a narrower region or more CPU would cost more, and Modal's placement time and the per-worker-type snapshot creations are outside the app. Fewer production deploys would cut the creations most.
