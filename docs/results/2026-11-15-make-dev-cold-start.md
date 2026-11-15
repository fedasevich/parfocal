# Result: make dev from a clean checkout to the logged-in home screen

- Date: 2026-11-15
- Backlog: FOUND-009
- Kind: baseline
- Commit: the FOUND-009 commit on the train branch of 2026-11-15
- Environment: Apple M4, 24 GB, macOS 15 (Darwin 24.6.0), Docker Desktop, Node 26.13.1, bash 3.2, Chrome headless through Playwright. Other agents were working on the same Mac
- Data: the ČVUT showcase seed, invented people only

## Question

Does `make dev` take a machine from a checkout to the logged-in home screen in under 10 minutes, the FOUND-009 budget?

## Method

1. Start from a worktree with no `node_modules`, `.venv`, `.env` or `.zitadel`, and no Docker volumes for the compose projects `found009` and `found009-zitadel`, so the database, MinIO, Zitadel and its OpenTofu state are all new.
2. Run `make dev` with `PARFOCAL_DEV_PROJECT=found009` and the ports moved (Postgres 15432, PgBouncer 16432, MinIO 19000, Zitadel 18089, Mailpit 18025, web 15173, API 18000), because the shared stack held the default ports.
3. When it prints `== Ready`, run `pnpm --filter @parfocal/e2e dev:check`. It signs in through the app's own sign-in page, waits for the home screen's "Start something" row, checks that "No workspace yet" is absent and that `/api/auth/session` answers 200.
4. Time both from the start with `date +%s`. The per-step times are the `SECONDS` stamps `scripts/dev.sh` prints.

Warm on this Mac: the Docker images (705 MB PostGIS, 415 MB Postgres 17, 224 MB Zitadel, 199 MB MinIO, 49 MB Mailpit, 30 MB PgBouncer), the pnpm store and the uv cache. Nothing was pruned to fake a colder run.

## Results

| Step | Started at |
|---|---|
| pnpm install | 0 s |
| uv sync | 4 s |
| Writing `.env` | 4 s |
| Postgres, PgBouncer and MinIO | 5 s |
| Local Zitadel and its OpenTofu apply | 9 s |
| Migrations | 27 s |
| Local bucket | 33 s |
| Showcase seed | 34 s |
| API and web app | 40 s |
| Ready | 46 s |

| Measure | Seconds |
|---|---|
| `make dev` ready | 46 |
| Signed in on the home screen | 62 |
| A second run on the same stack, ready | 16 |

## Interpretation

With warm caches the budget holds by a wide margin, and the 10 minutes are left for downloads. A truly new machine also pulls about 1.6 GB of images and fills the pnpm and uv caches, which this run did not measure. TODO: time a run on a machine with empty Docker, pnpm and uv caches, or in CI on a fresh runner.

## Follow-ups

[ADR 0342](../adr/0342-make-dev-signs-in-through-the-local-zitadel.md) (make dev signs in through the local Zitadel) records why identity runs locally. The edge Worker under `vite dev` with a remote R2 binding to `parfocal-dev` is still not wired, and this run did not open a slide in the viewer.
