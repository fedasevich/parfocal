# Deploying

OPS-002 (deploy definitions) put everything a deploy needs in git. Production is the only cloud environment (ADR 0293, production only until the first real user). Every definition still takes an environment name, so OPS-014 (bring back staging) only has to switch the second one on.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Environments | `workers/deploy/src/parfocal_deploy/environments.py` | One record per environment: Worker name, hostname, Modal environment, Neon branch, OpenTofu root and slide bucket |
| Edge Worker | `apps/edge/wrangler.jsonc` | The top level is the local `parfocal-edge-dev`. `env.production` is `parfocal-edge` on the Workers Custom Domain `app.parfocal.eu`, and `env.staging` is kept as a definition. The Worker serves the web build itself with `run_worker_first` ([ADR 0050](../adr/0050-deploy-pipeline-and-previews.md), the deploy pipeline), and passes `/api` through to `API_ORIGIN` |
| Modal apps | `workers/deploy/src/parfocal_deploy/modal_app.py` and `parfocal_ml.modal_pool` | App `parfocal-api` with the functions `web` (the FastAPI app) and `ingest`, whose memory comes from `INGEST_MEMORY_MIB` in `parfocal_ingest.settings`. Both scale to zero |
| Neon | `workers/deploy/src/parfocal_deploy/neon.py` | Lists branches and creates the environment's branch only when it is missing. It never deletes |
| Bootstrap | `pnpm --filter @parfocal/deploy bootstrap --env production` | Run once from the owner's Mac. It makes the secrets and the database role |
| Deploy | `pnpm --filter @parfocal/deploy run deploy --env production` | What CI runs from `.github/workflows/deploy.yml`, started by hand |

## Bootstrap, once per environment

It needs `NEON_API_KEY`, `NEON_PROJECT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in the shell, plus working Wrangler, Modal and OpenTofu logins. It reads the login app from `infra/tofu/tofu.sh prod output -json`.

1. It makes sure the Neon branch exists.
2. When the Modal secret `parfocal-api-keys` is missing, it generates the session, master, tile token and room token keys, creates the role `parfocal_app` (it can log in and cannot bypass row-level security, like `infra/local/postgres-init.sql`), writes the two token keys to the Worker and writes the keys with the pooled `DATABASE_URL` to Modal. This secret is never overwritten.
3. It always rewrites the Modal secret `parfocal-api-config` with the origin, the login app, the bucket and the storage credentials.

A second run writes only the config secret. If the role exists but the keys secret does not, the password is lost and the script stops. `--reset-app-role-password` sets a new one, which the owner agrees to first, because it is a rotation. No secret value is passed as a command argument. Set `EMAIL_BACKEND`, `ERROR_BACKEND`, `TELEMETRY_EXPORT`, `ANALYTICS_BACKEND` or `FLAG_BACKEND` in the shell to pass them into the config.

## Deploy, every time

CI needs the secrets `CLOUDFLARE_API_TOKEN`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` and `NEON_API_KEY` and the variables `CLOUDFLARE_ACCOUNT_ID` and `NEON_PROJECT_ID` in the GitHub environment `production`. The script stops and names whatever is missing, including Modal secrets that bootstrap has not made yet. Then it runs the migrations as the database owner on the direct connection, deploys both Modal apps, builds the web app, deploys the Worker with the Modal web URL as `API_ORIGIN`, and checks that `/api/health` answers 200 and that `/` carries the isolation headers.

## What the first production deploy needs

Nothing was deployed by OPS-002. The lead runs the first deploy with the owner, step by step.

1. A Neon API key, as `NEON_API_KEY` in the GitHub environment `production` and in the owner's shell, and the variable `NEON_PROJECT_ID` (decision 88, credentials that the production deploy needs).
2. An R2 S3 access key for the bucket `parfocal-dev` for the API (decision 93, what the first production deploy still needs).
3. `https://app.parfocal.eu` added to the CORS origins of `parfocal-dev` in the dev OpenTofu root. Today only `http://localhost:5173` is allowed, so browser uploads from the deployed app would fail. It is an in-place change, confirm with `tofu plan` that nothing is replaced.
4. A choice of email, error and analytics backends, because `APP_ENV=prod` refuses to start without real keys or an explicit override.
5. One bootstrap run, then the `Deploy` workflow.

## The shared bucket

The deployed app reads and writes the existing bucket `parfocal-dev`, the only slide store until staging returns. `slide_bucket` in `environments.py` is the single setting to change. Local runs use MinIO and the bucket `parfocal-local` by default, so they stay off the deployed objects. Two things do reach `parfocal-dev` from a Mac: checks that use the `R2_*` settings, and `wrangler dev --remote` with the top-level binding. Give such checks their own key prefix and delete what they wrote.

## Postgres version

Neon runs PostgreSQL 18.7. `CREATE EXTENSION postgis` worked on a throwaway branch on 2026-11-13 and reported PostGIS 3.6.4, so the project stays. Local development and CI still run `imresamu/postgis:17-3.6.1-alpine3.22`. TODO: move them to a Postgres 18 image with PostGIS 3.6, which changes the data directory layout and needs every local volume recreated, and amend [ADR 0018](../adr/0018-postgres-sqlalchemy-rls.md) (Postgres with PostGIS and row-level security).

## Not checked yet

- TODO: repeat the bounded cell import benchmark ([result](../results/2026-11-01-bounded-cell-import.md)) on Modal once ingest runs there.
- TODO: nothing starts the `ingest` function yet. The API still has to spawn it or a schedule has to run it.
- TODO: whether `wrangler secret bulk` creates a Worker that does not exist yet. If it does not, deploy the Worker once before bootstrap.
- TODO: the field name in `modal secret list --json`. The code accepts `Name` and `name`.
- The Modal web URL is public. The edge rate limits and the bot check guard only the path through the Worker until SEC-042 (the edge limits and the bot check guard the real API path) closes it.
