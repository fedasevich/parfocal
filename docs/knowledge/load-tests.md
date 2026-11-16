# Load tests

Locust scenarios for the API, tiles and realtime, run on demand ([ADR 0286](../adr/0286-load-tests-run-on-locust.md), load tests on Locust with a target guard, as amended by [ADR 0350](../adr/0350-load-tests-run-against-production-under-a-tiny-cap.md), load tests against production under a tiny cap). They are level 7 of the test pyramid in [ADR 0273](../adr/0273-test-pyramid-and-ownership.md) and never run on a pull request.

## Files

| File | What it does |
|---|---|
| `scripts/load/run.py` | `pnpm load:run`. Runs the chosen scenarios against one origin, writes CSV files and prints one table. Exits 3 when every scenario skipped |
| `scripts/load/locustfile.py` | The three user classes `ApiUser`, `TileUser` and `RoomUser`. `pnpm load` runs Locust on it directly |
| `scripts/load/target.py` | The target guard and the cloud cap, tested by `scripts/test_load_target.py` (unittest only, because the docs workflow has no pytest) |
| `scripts/load/local_token.py` | Mints or removes a two-hour service token in the local compose database only, under a `load-smoke` tenant |
| `.github/workflows/load.yml` | The `load` workflow, `workflow_dispatch` only, in the `production` environment |

## The guard

Localhost, `parfocal.eu` with its subdomains, `modal.run` hosts and the one exact host in `PARFOCAL_LOAD_ALLOW_HOST` pass. Any target that is not localhost runs only headless with a set run time, at most 2 users and 60 seconds per scenario. `PARFOCAL_LOAD_LIFT_LIMITS` lifts the user and time caps for OPS-012 (load and soak testing), after a budget check. Every production run is a production touch, so log it with its cost.

## Settings

`run.py` takes `--origin`, `--scenarios` (default `api,tiles,room`), `--users` (default 1), `--seconds` (default 30) and `--out` (default `out/load`). The origin is Locust's `--host`, and `PARFOCAL_LOAD_REALTIME_URL` defaults to it, because production serves the API, `/tiles/` and `/rt/` from one Worker.

| Variable | Used by | Meaning |
|---|---|---|
| `PARFOCAL_LOAD_TOKEN` | `ApiUser`, `TileUser` | A `pf_` service token with `see-slides`. Without it `ApiUser` reads only `/api/health` |
| `PARFOCAL_LOAD_SLIDES` | `TileUser` | Comma-separated slide ids. With a token, each view asks `getTileAccess` and reads the original with the capability token. Without one it reads the dev path `/tiles/<id>/levels.json` and `slide.tiff`, on localhost only |
| `PARFOCAL_LOAD_TILES_URL` | `TileUser` | Tile origin, default the origin |
| `PARFOCAL_LOAD_REALTIME_URL` | `RoomUser` | Edge origin for `/rt/<room>` |
| `PARFOCAL_LOAD_ROOM` | `RoomUser` | Room name such as `slide:<uuid>`, default `user:<PARFOCAL_LOAD_USER>` |
| `PARFOCAL_LOAD_SESSION` | `RoomUser` | A member's session cookie value. Room access is for members only, so a service token cannot open a room |
| `ROOM_TOKEN_KEY`, `PARFOCAL_LOAD_TENANT`, `PARFOCAL_LOAD_USER`, `PARFOCAL_LOAD_PROJECT` | `RoomUser` | Without a session, the scenario signs its own room tokens with the edge's key. Local only |
| `PARFOCAL_LOAD_ALLOW_HOST` | all | One exact extra host the guard lets through |

Service tokens are rate limited per principal and the Worker limits `/tiles/` per address, so 429 answers in a heavy run are the limiters, not a fault.

## Runs

A production run with no secrets: `pnpm load:run --origin https://app.parfocal.eu --users 2 --seconds 60`. The API scales to zero, so the first request after a quiet spell takes about 8 s. Wake it with one `curl` of `/api/health` first, or read the max column as the cold start. On 2026-11-16 it made 53 health reads at 230 ms p50 and 690 ms p95 for about $0.002 of Modal time ([result](../results/2026-11-16-load-scenarios-on-production.md)).

The workflow reads the `production` environment secrets `PARFOCAL_LOAD_TOKEN` and `PARFOCAL_LOAD_SESSION` and variables `PARFOCAL_LOAD_SLIDES` and `PARFOCAL_LOAD_ROOM`. None exist yet, which is decision 124 (a production token and session for the load workflow).

A local run with a token, keeping to a few users for under 30 seconds on the shared Mac. Put the token lines in a script, since worktree agents run one plain command per call:

```
pnpm db:up
pnpm load:token mint > "$PAD/token"
uv run --package parfocal-api --env-file .env uvicorn parfocal_api.app:create_app --factory --port 8765
PARFOCAL_LOAD_TOKEN=$(cat "$PAD/token") pnpm load:run --origin http://localhost:8765 --scenarios api --users 2 --seconds 20
pnpm --filter @parfocal/web exec vite --port 5199 --strictPort
PARFOCAL_LOAD_SLIDES=a,b pnpm load:run --origin http://localhost:5199 --scenarios tiles --users 2 --seconds 20
pnpm load:token remove
```

`RoomUser` has never joined a real room. No edge Worker runs locally, because `apps/edge` has no dev script, so its local joins can only fail with connection refused, and production needs a member session.
