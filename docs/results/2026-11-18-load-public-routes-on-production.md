# Result: signed-out route load on production and the local tile read

- Date: 2026-11-18
- Backlog: TEST-010 (load test tooling)
- Kind: load test
- Environment: Locust on the owner's Apple M4 Mac, over its own internet connection to `https://app.parfocal.eu` (the Cloudflare Worker in front of the Modal app `parfocal-api`). `app.parfocal.eu` is a development environment ([ADR 0390](../adr/0390-app-parfocal-eu-is-a-development-environment.md), the deployed app is dev). The tile run used the Vite dev server fixture path on port 5199, not the edge
- Data: no slide, session or token was used on production

## Question

How fast do the signed-out routes answer on production, and can the tile scenario be measured there without a session?

## Method

One `/api/health` request woke the API, then at 23:28:34 UTC to 23:29:41 UTC:

```
pnpm load:run --origin https://app.parfocal.eu --scenarios public --users 2 --seconds 60
```

The new `PublicUser` scenario reads `/`, `/login`, `/api/health`, expects 401 from `/api/projects` and from `/tiles/<random id>/levels.json` without a token, and counts any other status as a failure. The guard caps cloud runs at 2 users and 60 seconds ([ADR 0350](../adr/0350-load-tests-run-against-production-under-a-tiny-cap.md), load tests against production under a tiny cap), so the 20 users asked for were not used.

Local tile read: `PARFOCAL_LOAD_SLIDES=a,b pnpm load:run --origin http://localhost:5199 --scenarios tiles --users 2 --seconds 20`.

## Results

Production, 2 users for 60 seconds:

| Request | Count | Failures | p50 ms | p95 ms | Max ms |
|---|---:|---:|---:|---:|---:|
| GET / shell | 30 | 0 | 39 | 65 | 68 |
| GET /login shell | 18 | 0 | 43 | 140 | 140 |
| GET /api/health | 13 | 0 | 90 | 210 | 210 |
| GET /api/projects signed out (401) | 14 | 0 | 94 | 220 | 223 |
| GET /tiles/[id]/levels.json signed out (401) | 10 | 0 | 41 | 140 | 142 |
| Aggregated | 85 | 0 | 50 | 120 | 223 |

Local fixture tile reads, 2 users for 20 seconds, no edge:

| Request | Count | Failures | p50 ms | p95 ms | Max ms |
|---|---:|---:|---:|---:|---:|
| GET /tiles/[id] header | 30 | 0 | 1 | 12 | 22 |
| GET /tiles/[id] range | 240 | 0 | 1 | 11 | 26 |
| GET /tiles/[id]/levels.json | 30 | 0 | 1 | 68 | 745 |

Cost: about $0.002 of Modal time, by the 2026-11-16 run of the same size, which made 53 requests ([result](2026-11-16-load-scenarios-on-production.md)). This run made 85 requests, of which only the API ones (27) reach Modal. The Modal report was not read, so the figure is an estimate. Cloudflare usage: TODO.

## Conclusion

The signed-out routes on production answer in about 50 ms at p50 and 120 ms at p95 with no failures, and the Worker refuses unauthenticated tile reads with 401. Tile reads through the edge with a capability token were not measured on production, because a session needs a password and the smoke account does not exist yet (TODO in the deploy notes). The local tile numbers come from the dev fixture, not the edge, because the edge needs the full Worker stack. TEST-010 stays in review until decision 124 (a load workflow token) lands.
