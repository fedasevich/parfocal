# Result: warm /api/me, /api/projects and /api/me/home answer in 145 to 227 ms at the median of ten calls on v0.35.12

- Date: 2026-11-21
- Backlog: OPS-030 (a warm API call answers in under 300 ms)
- Kind: production measurement
- Commit: `ad05cea` (v0.35.12 as deployed on app.parfocal.eu, just after the reseed of GitHub Actions run 44956558900)
- Environment: MacBook with Apple M4 on a home connection in Europe, headless Chromium shell build 1248 driven by Playwright 1.65.1, signed in as the agent test account through `scripts/agent_session.py` with its own session. Modal app `parfocal-api` in environment `main`, containers in GCP `eu-west`
- Data: the seeded ČVUT workspaces, no PHI

## Question

Do warm `/api/me`, `/api/projects` and `/api/me/home` answer in under 300 ms at the median of ten calls, and where do the ten slowest routes of the [before table](2026-11-17-warm-api-round-trips.md) (warm API round trips) stand now?

## Method

1. A page of the app was opened with the saved session. In the page, each route was fetched five times to warm it, then ten times in a row. Each call was timed with `performance.now()` from the fetch to the end of the body, and its `Server-Timing` header was parsed.
2. The run was repeated about ten minutes later, after a local Docker stack had been stopped.
3. `modal app logs parfocal-api --env main --since 1h --search "request finished"` gave 1,936 lines with a 2xx status after the reseed ended at 22:36 UTC. Most traffic came from another agent walking the app's screens at the same time. The median per route was taken from `duration_ms`, `db_ms`, `sql_ms`, `queries` and `transactions`.

## Results

Ten warm calls in the browser, every answer 200.

| Route | Run | Browser median | Browser calls (ms) | `app` median | `db` median | `sql` median | Queries | Transactions |
|---|---|---:|---|---:|---:|---:|---:|---:|
| `/api/me` | 1 | 157 ms | 169, 132, 222, 123, 163, 128, 151, 122, 168, 194 | 47.3 | 45.1 | 30.1 | 5 | 2 |
| `/api/me` | 2 | 144.5 ms | 124, 283, 127, 203, 118, 168, 123, 169, 126, 162 | 48.6 | 46.1 | 29.9 | 5 | 2 |
| `/api/projects` | 1 | 181.5 ms | 214, 185, 138, 200, 138, 178, 211, 167, 131, 226 | 59.1 | 58.4 | 42.7 | 6 | 2 |
| `/api/projects` | 2 | 177.5 ms | 210, 177, 184, 139, 195, 122, 182, 127, 178, 116 | 63.8 | 62.9 | 44.0 | 6 | 2 |
| `/api/me/home` | 1 | 222 ms | 310, 201, 326, 171, 240, 222, 222, 210, 243, 205 | 122.3 | 120.5 | 92.2 | 12 | 2 |
| `/api/me/home` | 2 | 226.5 ms | 163, 363, 162, 361, 159, 249, 161, 261, 217, 236 | 107.2 | 105.3 | 72.9 | 12 | 2 |

The before table's ten slowest routes, after, from the request log (GET, 2xx only).

| Route | Before median ms (queries) | After calls | After median ms, max | `db` ms | `sql` ms | Queries |
|---|---|---:|---|---:|---:|---:|
| `/api/slides/{slide_id}/tissue` | 252 (6), both calls 404 | 31 | 149.2, 198.2 | 145.9 | 55.6 | 5 |
| `/api/rooms/{room}/access` | 161 (7) | 55 | 110.6, 305.1 | 107.4 | 70.3 | 6 |
| `/api/result-sets/{id}/cell-chunks/{chunk}` | 160 (8) | 81 | 183.5, 577.0 | 182.3 | 67.2 | 7 |
| `/api/result-sets/{id}/cell-summary` | 155 (7) | 23 | 205.4, 367.4 | 204.1 | 63.9 | 6 |
| `/api/tenant/session-policy` | 152 (6) | 62 | 103.8, 506.1 | 98.6 | 63.2 | 5 |
| `/api/slides/{slide_id}/tile-access` | 150 (8) | 40 | 135.6, 223.8 | 133.5 | 80.1 | 7 |
| `/api/me/availability` | 146 (6) | 59 | 117.3, 543.3 | 115.0 | 72.4 | 5 |
| `/api/slides/{slide_id}/neighbours` | 142 (16) | 33 | 164.8, 618.0 | 162.0 | 97.9 | 5 |
| `/api/projects/{project_id}` | 137 (9) | 48 | 126.6, 214.4 | 122.6 | 80.2 | 6 |
| `/api/slides/{slide_id}/thumbnail` | 130 (6) | 248 | 216.7, 693.8 | 212.2 | 53.4 | 5 |
| `/api/me` | 23 (5) | 87 | 73.8, 1516.2 | 71.1 | 47.1 | 5 |
| `/api/projects` | owner's 3.8 s | 56 | 93.7, 207.8 | 92.0 | 67.9 | 6 |
| `/api/me/home` | owner's 7.5 s | 42 | 241.7, 427.5 | 238.8 | 178.6 | 12 |

The slowest GET routes in the same log, which were not in the before table.

| Route | Calls | Median ms, max | `db` ms | `sql` ms | Queries |
|---|---:|---|---:|---:|---:|
| `/api/me/assigned-tasks` | 2 | 1527.5, 1557.9 | 1524.3 | 1369.3 | 121 |
| `/api/review-tasks/{task_id}/slides/{slide_id}/shared-layer/ai` | 3 | 960.7, 1355.3 | 952.3 | 261.1 | 14 |
| `/api/study-templates/review-defaults` | 1 | 886.3 | 193.8 | 177.3 | 5 |
| `/api/review-tasks/{task_id}/sign-off-summary` | 1 | 575.5 | 571.1 | 525.0 | 29 |
| `/api/projects/{project_id}/overview` | 5 | 542.7, 645.9 | 542.0 | 467.8 | 27 |
| `/api/review-tasks/{task_id}/adjudication` | 1 | 483.9 | 480.6 | 440.7 | 24 |
| `/api/review-tasks/{task_id}/slides/{slide_id}/edits/{object_id}/history` | 5 | 428.9, 779.1 | 427.1 | 180.2 | 14 |
| `/api/review-tasks/{task_id}/disagreement-queue` | 2 | 408.9, 428.5 | 406.5 | 361.1 | 31 |
| `/api/me/slides` | 87 | 294.1, 781.6 | 289.1 | 237.6 | 16 |

## Interpretation

- All three routes meet the 300 ms median in both runs, measured end to end in the browser.
- The before table's routes now run 5 to 7 queries each, and all ten stay under 300 ms at the median. Six got faster and four got slower: thumbnail 130 to 217 ms, cell-summary 155 to 205 ms, cell-chunks 160 to 184 ms and neighbours 142 to 165 ms. The before medians came from one to six calls of one person and the after ones from another agent's concurrent load, so the comparison is rough.
- `/api/me/assigned-tasks` runs 121 queries in 1.5 s, which looks like a read per task in a loop. It is outside OPS-030's three routes.

## Follow-ups

- `TODO` a backlog task to cut the 121 queries of `/api/me/assigned-tasks` and to look at the review task routes of 24 to 31 queries.
