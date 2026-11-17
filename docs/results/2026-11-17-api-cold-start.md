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

After samples: TODO, taken once the lead deploys main with this change. The first one or two cold starts after a deploy create the snapshot rather than restore it, so discard them.

## The change

The web function sets `enable_memory_snapshot=True` and runs on the app image plus one environment variable, `PARFOCAL_PRELOAD=web`. With that variable set, `parfocal_deploy.modal_app` imports `parfocal_api.app` and the other modules `serve()` needs at module scope. Modal takes the snapshot after the module import and before it calls `serve()`, so restored containers skip the imports. `create_app()` still runs after restore, because it reads the secrets and builds the database engine and HTTP clients, none of which belong in a snapshot. Ingest and the event sweep do not set the variable and are unchanged. Memory snapshots cost nothing extra on Modal, and `min_containers` stays 0.

Lazy imports and a lighter web image were not built. A restored snapshot already holds the imported modules, so making them lazy would move their cost to the first request that needs them. A separate web lock would add a second image to keep in step for a pull that Modal's lazy image loading mostly hides. Both are worth doing only if the after samples stay over 3 s, and then the next target is `create_app` and the lifespan query.
