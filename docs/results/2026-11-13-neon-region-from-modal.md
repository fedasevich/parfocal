# Result: Neon region seen from Modal's API containers

- Date: 2026-11-13
- Backlog: STACK-020 (database, ORM and migrations)
- Kind: baseline
- Commit: the deployed API, `parfocal-api` version v4 from commit `2ca8574`, and v3 from `c5a72f2` for the earlier part of the window
- Environment: production as it runs, read only. Modal environment `main`, web function with no `region=` pin, `max_containers` 4, no `@modal.concurrent`, so one request at a time per container. Neon project `soft-pine-86468744` on the free plan
- Data: the API's own request log lines (route, status and `duration_ms`), no request bodies, no user data

## Question

Which Neon region gives the API the lowest latency from Modal's containers, as [ADR 0003](../adr/0003-pilot-platform-architecture.md) (pilot platform architecture) asked? The STACK-020 brief wanted a measured answer before ticking.

## Method

The owner allowed no writes, no `modal run`, no secret reads and no Neon calls for this run. So nothing new ran inside Modal, and a second Neon project in another region could not be created. What could be read:

1. Where Neon is today, from the repo. [knowledge/agent-tooling.md](../knowledge/agent-tooling.md) lists the project as US East with the Vercel name `iad1`, and [decisions.md](../decisions.md) row 90 (the Neon region question the owner answered) names the Neon region `aws-us-east-1`. Both mean the same place, Neon's AWS region in Northern Virginia. `iad1` is only the Vercel Marketplace label.
2. Where Modal is, from the endpoint. The web URL is `fedasevich--parfocal-api-web.us-east.modal.run`. The `us-east` part names Modal's ingress, not where containers run. With no `region=` pin Modal places each container where it chooses, so container placement is not verified by anything below.
3. The API's request log from the last 24 hours, read with `modal app logs parfocal-api -e main --since 24h --tail 5000 --show-container-id --timestamps`. Each `request finished` line carries `duration_ms`, timed inside the app by `RequestLogging`. It excludes the network between the user and Modal and any queueing before the container, but includes every database round trip the request makes. The scripts grouped the lines by container and by route. Lines for `/api/health` (no database work) and unmatched routes were left out of the database figures.
4. How many database round trips one request makes, read from the code. `packages/py-common/src/parfocal_common/db.py` opens each tenant transaction with `BEGIN`, a `SELECT set_config(...)` for tenant, user, platform and auth, then the route's queries, then `COMMIT`, over asyncpg with SQLAlchemy's default pool. So a request that reads anything makes at least four round trips to Neon.

## Results

467 requests between 19:48 and 21:14 UTC on 2026-11-13, served by 20 containers across two deploys (19:48 and 20:45 UTC).

| Containers | Requests with database work | Fastest | Median | 90th percentile |
|---|---:|---:|---:|---:|
| `ta-01M7BB30RB…`, steady from 20:55 to 21:14 UTC | 26 | 19.9 ms | 37.2 ms | 49.8 ms |
| `ta-01M7B78XMD…`, after the 19:48 deploy | 19 | 28.4 ms | 36.0 ms | 101.7 ms |
| `ta-01M7B8E43D…`, a burst at 20:09 UTC | 10 | 32.8 ms | 35.3 ms | 265.2 ms |
| `ta-01M7BAHCAZ…`, after the 20:45 deploy | 62 | 22.6 ms | 106.8 ms | 581.6 ms |
| `ta-01M7BAGQP6…`, after the 20:45 deploy | 25 | 186.4 ms | 558.1 ms | 828.8 ms |
| `ta-01M7BAGRTE…`, after the 20:45 deploy | 29 | 15.3 ms | 721.4 ms | 997.5 ms |

| All requests except health and unmatched | Count |
|---|---:|
| Under 5 ms (rejected before any database work) | 176 |
| 20 to 80 ms | 82 |
| 160 ms to 1.3 s | 136 |
| Over 1.3 s | 5 |

From 21:00 to 21:09 UTC one client polled `GET /api/rooms/{room}/access` every 30 s. All 20 polls took 19.9 to 47.0 ms, about 37 ms while they answered 403 and about 21 ms once the session had expired and they answered 401.

Slow requests came in three situations: the first database request on a new container (685, 922, 180, 389, 1,203 and 1,958 ms), the first burst after an idle gap of 13 and 23 minutes (20:22 and 20:45 UTC), and the ten minutes after the 20:45 deploy, when four new containers served about 170 requests between them.

For scale, a TCP connect from this Mac in Vienna to Modal's `us-east` ingress took a median 116 ms, which is one transatlantic round trip.

## Interpretation

- On a warm container the whole request, with at least four round trips to Neon, takes 20 to 50 ms. So one round trip from those containers to Neon is at most about 5 to 12 ms. A Neon project in an EU region would add one transatlantic round trip, about 90 to 120 ms, to each of the four or more, which puts the same request at 400 ms or more. Inference: those containers ran in the US East area next to `aws-us-east-1`.
- The slow cluster lines up with new containers, idle gaps and fresh deploys, which points at opening new asyncpg connections through Neon's pooler and at Neon's compute waking after its five-minute suspend on the free plan. Assumption, not measured: the log has no separate timer for connect or wake.
- One container, `ta-01M7BAGQP6…`, never went under 186 ms in 25 requests. That fits a container placed farther from Neon, a slow host, or a pool still opening connections under the post-deploy burst. The log cannot tell which. Because the web function has no region pin, placement stays unverified.
- A cross-region comparison, the brief's "lowest measured latency", could not be run under the read-only rule. It would need a second Neon project or a `modal run` from inside Modal.

## Decision

Neon stays in `aws-us-east-1` (Vercel label `iad1`). The warm figures show it is next to where Modal runs the API today, the owner already chose to keep it there (decisions.md row 90), and ADR 0003's plan to pin every region to the EU at the first tenant with real patient data is unchanged. Recorded as an amendment in [ADR 0018](../adr/0018-postgres-sqlalchemy-rls.md) (Postgres, SQLAlchemy and row-level security).

## Follow-ups

- Recommendation only, nothing changed: log `MODAL_REGION` and `MODAL_CLOUD_PROVIDER`, which Modal sets in every container, once at startup, and add a database time to the `request finished` line. That would turn the placement and connect questions into facts. TODO: a backlog task if the lead agrees.
- Recommendation only: if far placements show up in that log, pin the web function to `us-east` at Modal's 1.15 times price for a broad region rather than move Neon.
- TODO: [compliance/subprocessors.md](../compliance/subprocessors.md) and [knowledge/agent-tooling.md](../knowledge/agent-tooling.md) still call the Neon region a STACK-020 TODO or name only `iad1`. They should name `aws-us-east-1` and point here.
