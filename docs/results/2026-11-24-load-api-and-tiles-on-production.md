# Result: with a read-only service token the api and tiles scenarios ran on production at the tiny cap with no failures, tile reads 76 ms at p50, but the load workflow cannot start without an owner approval

- Date: 2026-11-24
- Backlog: TEST-010 (load test tooling)
- Kind: load test
- Environment: Locust 2.47.0 on the owner's Mac over its own internet connection to `https://app.parfocal.eu` on v0.51.0, the Cloudflare Worker in front of the Modal app `parfocal-api`. `app.parfocal.eu` is a development environment ([ADR 0390](../adr/0390-app-parfocal-eu-is-a-development-environment.md), the deployed app is dev)
- Data: two seeded public slides, `test_065` (CAMELYON16) and `Philips-4.tiff`, in "Scanner format comparison" of `cvut-biomedical`

## Question

Decision 124 (a load workflow token) was answered with option A: an agent mints a read-only service token in the test workspace and two slide ids go with it. How fast do the authenticated API routes and tile reads through the edge answer at the tiny cap of [ADR 0350](../adr/0350-load-tests-run-against-production-under-a-tiny-cap.md) (load tests against production under a tiny cap)?

## Method

1. Signed in as agent-walk and created the service account `load-test-read` in `cvut-biomedical` with the one scope `see-slides` and a token that expires on 2026-12-24. The token sits only in `~/.config/parfocal/load-token.env` (mode 600) and in the new production environment secret `PARFOCAL_LOAD_TOKEN`. The two slide ids are the new production environment variable `PARFOCAL_LOAD_SLIDES`.
2. Probed once with the token: `/api/projects`, `/api/search` and `tile-access` for both slides answered 200.
3. One `/api/health` request woke the API, then from 22:39:56 UTC:

```
PYTHONPATH=scripts uv run --locked --group load python scripts/load/run.py \
  --origin https://app.parfocal.eu --scenarios api,tiles --users 2 --seconds 60
```

4. Dispatched the `load` workflow with the same inputs, first on `main` (run 45503422340) and then on the tag `v0.51.0` (run 45503594810).

## Results

Local run, 2 users for 60 s per scenario, numbers from the run's summary table:

| Scenario | Request | Count | Failures | p50 ms | p95 ms | Max ms |
|---|---|---:|---:|---:|---:|---:|
| api | GET /api/health | 10 | 0 | 130 | 150 | 153 |
| api | GET /api/projects | 27 | 0 | 260 | 460 | 668 |
| api | GET /api/search | 16 | 0 | 290 | 380 | 385 |
| api | Aggregated | 53 | 0 | 270 | 380 | 668 |
| tiles | GET /api/slides/[id]/tile-access | 53 | 0 | 300 | 430 | 598 |
| tiles | GET /tiles/[id] header | 53 | 0 | 29 | 45 | 180 |
| tiles | GET /tiles/[id] range | 420 | 0 | 76 | 150 | 2652 |
| tiles | Aggregated | 526 | 0 | 76 | 300 | 2652 |

Locust's console counted 424 range reads at shutdown, four more than its stats file, which were still in flight.

Workflow runs:

| Run | Ref | Outcome |
|---|---|---|
| 45503422340 | `main` | failed in 2 s: "Branch main is not allowed to deploy to production due to environment protection rules" |
| 45503594810 | `v0.51.0` | waiting for a required reviewer of the `production` environment, the owner |

Cost: `TODO`. The 2026-11-16 run of 53 requests cost about $0.002 of Modal time. This run sent 106 requests to the API (53 in the api scenario and 53 tile-access calls), plus one wake and four probe calls, and tile header and range reads go to the Worker and R2 only. The Modal report was not read after the run.

## Interpretation

- Authenticated API routes answer in 260 to 300 ms at p50 and under 460 ms at p95. Tile range reads through the Worker answer in 76 ms at p50 and 150 ms at p95, with one slow read of 2.65 s, likely a cold R2 range.
- `tile-access` at 300 ms p50 is the slowest call of the tile path, because it reaches the API on Modal.
- The scenarios run against production on demand from a laptop. The workflow route does not run without the owner: the `production` environment admits only `v*` tags and asks the owner to approve each run.

- The room (realtime) scenario was not run. It needs `PARFOCAL_LOAD_REALTIME_URL` and either a signed-in session cookie in `PARFOCAL_LOAD_SESSION` or the room signing key in `ROOM_TOKEN_KEY` with a tenant and user. A service token cannot open a room, and a session cookie of a person does not belong in a GitHub secret.

## Follow-ups

- `TODO` the owner approves or cancels run 45503594810, and decides whether the `load` workflow gets its own environment without a reviewer that holds only `PARFOCAL_LOAD_TOKEN`.
- The token lives in the dev database. A reseed that recreates the database would remove the service account and leave the secret with a dead token, which was not checked. `TODO` mint again after such a reseed.
