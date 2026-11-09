# Load tests

Locust scenarios for the API, tiles and realtime, run on demand ([ADR 0278](../adr/0278-load-tests-run-on-locust.md), load tests on Locust with a target guard). They are level 7 of the test pyramid in [ADR 0273](../adr/0273-test-pyramid-and-ownership.md) and never run on a pull request. Never point them at production or any cloud URL other than staging.

## Files

| File | What it does |
|---|---|
| `scripts/load/locustfile.py` | The three user classes `ApiUser`, `TileUser` and `RoomUser` |
| `scripts/load/target.py` | The target guard, tested by `scripts/test_load_target.py` |
| `scripts/load/local_token.py` | Mints or removes a two-hour service token in the local compose database only, under a `load-smoke` tenant |

## Settings

The API origin is Locust's `--host`. Everything else comes from the environment.

| Variable | Used by | Meaning |
|---|---|---|
| `PARFOCAL_LOAD_TOKEN` | `ApiUser`, `TileUser` | A `pf_` service token with `see-slides`. `ApiUser` stops without it |
| `PARFOCAL_LOAD_SLIDES` | `TileUser` | Comma-separated slide ids. With a token, each view asks `getTileAccess` and reads the original with the capability token. Without one, it reads the dev path `/tiles/<id>/levels.json` and `slide.tiff` |
| `PARFOCAL_LOAD_TILES_URL` | `TileUser` | Tile origin, default `--host` |
| `PARFOCAL_LOAD_REALTIME_URL` | `RoomUser` | Edge origin for `/rt/<room>`. `RoomUser` stops without it |
| `PARFOCAL_LOAD_ROOM` | `RoomUser` | Room name such as `slide:<uuid>`, default `user:<PARFOCAL_LOAD_USER>` |
| `PARFOCAL_LOAD_SESSION` | `RoomUser` | A member's session cookie value. Room access is for members only, so a service token cannot open a room |
| `ROOM_TOKEN_KEY`, `PARFOCAL_LOAD_TENANT`, `PARFOCAL_LOAD_USER`, `PARFOCAL_LOAD_PROJECT` | `RoomUser` | Without a session, the scenario signs its own room tokens with the edge's key |
| `PARFOCAL_LOAD_ALLOW_HOST` | all | One exact extra host the guard lets through. Localhost and hosts with `staging` in a label pass without it |

Service tokens are rate limited per principal, so 429 answers in a heavy run are the limiter, not a fault.

## Local smoke run

Keep local runs to a few users for under 30 seconds, because the Mac is shared.

```
pnpm db:up
pnpm load:token mint > /tmp/load-token
uv run --package parfocal-api --env-file .env uvicorn parfocal_api.app:create_app --factory --port 8765
pnpm --filter @parfocal/web exec vite --port 5199 --strictPort
PARFOCAL_LOAD_TOKEN=$(cat /tmp/load-token) pnpm load --headless -u 3 -r 3 -t 20s --host http://localhost:8765 --only-summary ApiUser
PARFOCAL_LOAD_SLIDES=a,b pnpm load --headless -u 3 -r 3 -t 20s --host http://localhost:5199 --only-summary TileUser
pnpm load:token remove
```

On 2026-11-09 both ran with no failures: `ApiUser` made 31 requests and `TileUser` 460. `RoomUser` signed tokens and reported joins, but no edge Worker runs locally (wrangler is not installed and there is no Cloudflare Vite plugin), so its joins could only fail with connection refused. The first real realtime run waits for staging or a local wrangler.

## Staging run

When staging exists, mint a service token in the staging workspace, pick a few slide ids, and run each class against the staging origins with `--headless -u N -r N -t 5m --csv out/load`. OPS-012 (load and soak testing) owns the numbers and the `workflow_dispatch` job, which needs the token, the room token key and the slide ids as new repository secrets.
