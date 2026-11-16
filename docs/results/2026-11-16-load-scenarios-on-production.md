# Result: the load scenarios against production at the tiny default cap

- Date: 2026-11-16
- Backlog: TEST-010 (load test tooling)
- Kind: load test
- Commit: the TEST-010 commit on top of `ec459246`
- Environment: Locust 2.47 on Python 3.14 on the owner's Apple M4 Mac, shared with three other agents, over a home connection to `https://app.parfocal.eu` (the Cloudflare Worker in front of the Modal app `parfocal-api` in environment `main`). The local run used the compose Postgres and the API under uvicorn on port 8791
- Data: production holds only the owner's test data. No slide, upload or GPU job was touched

## Question

Do the scenarios run end to end against production through `pnpm load:run`, and what does a run at the cap of 2 users for 60 seconds cost?

## Method

A single `curl` of `/api/health` at 03:41 UTC woke the scaled-to-zero API first. Then, from 03:42:40 to 03:45:41 UTC:

```
pnpm load:run --origin https://app.parfocal.eu --users 2 --seconds 60
```

No service token, slide ids or session were set, because agents hold no production credential. So `ApiUser` read only `/api/health`, and `TileUser` and `RoomUser` stopped at start. The API scenario with a token then ran on the local stack, with a two-hour token from `pnpm load:token mint` that was removed afterwards:

```
PARFOCAL_LOAD_TOKEN=... pnpm load:run --origin http://localhost:8791 --scenarios api --users 2 --seconds 20
```

Cost is the Modal hourly billing report (`uvx modal billing report --for today -r h --csv`) for `parfocal-api` in `main`, read before and after the run.

## Results

Production, 2 users for 60 seconds:

| Scenario | Request | Count | Failures | p50 ms | p95 ms | Min ms | Max ms | Mean ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| api | GET /api/health | 53 | 0 | 230 | 690 | 139 | 1013 | 274 |
| tiles | none, skipped without a token and slide ids | 0 | | | | | | |
| room | none, skipped without a session or room key | 0 | | | | | | |

The wake-up `curl` took 8.4 s, which is the cold start. The run itself started warm.

Local stack, API scenario with a token, 2 users for 20 seconds:

| Request | Count | Failures | p50 ms | p95 ms | Max ms |
|---|---:|---:|---:|---:|---:|
| GET /api/health | 2 | 0 | 3 | 3 | 3 |
| GET /api/projects | 9 | 0 | 18 | 230 | 228 |
| GET /api/search | 9 | 0 | 26 | 240 | 241 |

Cost: the Modal report for `parfocal-api` in `main` for the 03:00 UTC hour read $0.00146 before the wake-up and $0.00248 after the run, so the run and the cold start cost at most $0.0010, with any other traffic in that hour included. Cloudflare usage: TODO, because agents have no read of Worker request counts. 54 requests are far inside the Workers plan.

A run asking for 3 users against production stopped before any request with "A cloud target allows at most 2 users".

## Conclusion

The tooling runs against production on demand, and a capped run costs about a thousandth of a dollar. Only `/api/health` was measured on production. The tile and room scenarios have not run against production, and the room scenario has never joined a real room, because no local edge runs. Both wait for the secrets in decision 123 (a production token and session for the load workflow). The `load` workflow has not run yet.
