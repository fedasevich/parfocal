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
| Deploy | `pnpm --filter @parfocal/deploy run deploy --env production` | What CI runs from `.github/workflows/deploy.yml`, by hand or after a green CI run on `main` once the owner turns that on |
| Migration check | `workers/deploy/src/parfocal_deploy/migrations.py` | Reads the revisions the database has not run and refuses the ones that drop, rename or rewrite data |

## Bootstrap, once per environment

It needs `NEON_API_KEY`, `NEON_PROJECT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `MODAL_PROXY_TOKEN_ID` and `MODAL_PROXY_TOKEN_SECRET` in the shell, plus working Wrangler, Modal and OpenTofu logins. It reads the login app from `infra/tofu/tofu.sh prod output -json`.

1. It makes sure the Neon branch exists.
2. When the Modal secret `parfocal-api-keys` is missing, it generates the session, master, tile token and room token keys, creates the role `parfocal_app` (it can log in and cannot bypass row-level security, like `infra/local/postgres-init.sql`), writes the two token keys to the Worker and writes the keys with the pooled `DATABASE_URL` to Modal. This secret is never overwritten.
3. It always rewrites the Modal secret `parfocal-api-config` with the origin, the login app, the bucket and the storage credentials.

A second run writes only the config secret. If the role exists but the keys secret does not, the password is lost and the script stops. `--reset-app-role-password` sets a new one, which the owner agrees to first, because it is a rotation. No secret value is passed as a command argument. Set `EMAIL_BACKEND`, `ERROR_BACKEND`, `TELEMETRY_EXPORT`, `ANALYTICS_BACKEND` or `FLAG_BACKEND` in the shell to pass them into the config.

## Deploy, every time

CI needs the secrets `CLOUDFLARE_API_TOKEN`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` and `NEON_API_KEY` and the variables `CLOUDFLARE_ACCOUNT_ID` and `NEON_PROJECT_ID` in the GitHub environment `production`. The script stops and names whatever is missing, including Modal secrets that bootstrap has not made yet. Then it runs the migrations as the database owner on the direct connection, deploys both Modal apps, builds the web app, deploys the Worker with the Modal web URL as `API_ORIGIN`, and checks that `/api/health` answers 200 and that `/` carries the isolation headers.

## Main to production

[ADR 0297](../adr/0297-main-deploys-to-production-behind-a-switch-with-a-migration-check-and-rollback-by-redeploy.md) (main deploys behind a switch, migration check, rollback by redeploy) is the record. `deploy.yml` also starts when the `ci` workflow finishes. The job runs only when the repository variable `DEPLOY_ON_MAIN` is `true` and CI passed for a push to `main`. It deploys the commit CI tested, and stops quietly when `main` has a newer commit, whose own run deploys.

- Turn it on: `gh variable set DEPLOY_ON_MAIN --body true`. It must be a repository variable, an environment variable is not seen by the gate.
- Turn it off: `gh variable set DEPLOY_ON_MAIN --body false`.
- A deploy by hand works either way: `gh workflow run deploy.yml --ref main -f environment=production`, or `--ref vX.Y.Z` for a tag.
- `gh run list --workflow deploy.yml --status success` is the release history. Each run is titled `deploy <commit>` or `rollback <ref>`. A run that was replaced by a newer commit is green too and deployed nothing. Its log ends with "nothing was run", and a real one ends with "is deployed at".
- TODO: if the `production` environment has protection rules, such as required reviewers, automatic runs wait for them.

## Migration safety check

Before Alembic runs, the deploy reads the database's revision and checks every later revision file without running it. A revision that drops or renames a table or column, changes a column type, or holds `TRUNCATE` or `DELETE FROM` outside its `downgrade` stops the deploy before anything is touched. The message names the revision and the finding.

The owner's yes is a deploy by hand that names the revisions: `gh workflow run deploy.yml --ref main -f environment=production -f allow_destructive=0111`. The automatic path can never pass it. Write migrations as expand then contract: add first, ship the code that stops using the old column, and drop in a later release by hand. To see what a new revision would trip before merging:

```sh
uv run --package parfocal-deploy python -c "from parfocal_deploy import migrations as m; print(m.load(m.VERSIONS)['0111'].findings)"
```

## Rollback

`gh workflow run deploy.yml --ref main -f rollback_to=<commit or tag>` checks out that ref and deploys its Modal apps, web build and Worker. It runs no migration and makes no database or Neon call, so the schema stays ahead of the code, which expand-only migrations keep safe.

- Turn automatic deploys off first with `gh variable set DEPLOY_ON_MAIN --body false`. Otherwise the next green push to `main` deploys the bad commit again, and its run can cancel a rollback that is still waiting. Turn them on again only after the fix is on `main`.
- Pick the target from the release history above. The oldest usable target is the commit that added `--skip-migrations`, because an older script stops on the unknown flag.
- Never roll back past a destructive migration that already ran. That needs a restore, which OPS-008 (backups and disaster recovery) owns.
- TODO: a rollback across a new Durable Object migration tag in `apps/edge/wrangler.jsonc` is untested.
- After it finishes, check that the old code answers, and stop leftover Modal containers if not ([platform.md](platform.md), old Modal containers can keep serving after a deploy).
- Rolling forward again is a normal deploy of `main`.

### The rollback drill, not run yet

OPS-005 (continuous deployment) is done when this succeeds on production. TODO: run it and record the times in the log.

1. `gh variable set DEPLOY_ON_MAIN --body false`, when it is on.
2. From the release history take two commits whose runs really deployed, `A` (older) and `B` (live). They must differ in something visible, such as a route or a text.
3. `gh workflow run deploy.yml --ref main -f rollback_to=A`, then `gh run watch`.
4. Check that the smoke check passed and that the visible difference shows `A`. Stop leftover Modal containers if it still shows `B`.
5. `gh workflow run deploy.yml --ref main -f environment=production` to go back to `B`, and check again.
6. Turn `DEPLOY_ON_MAIN` back to what it was, and log both production touches with their cost.

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

Neon runs PostgreSQL 18.7. `CREATE EXTENSION postgis` worked on a throwaway branch on 2026-11-13 and reported PostGIS 3.6.4, so the project stays. Local development and CI run `imresamu/postgis:18-3.6.1-alpine3.22` since 2026-11-13, as the amendment to [ADR 0018](../adr/0018-postgres-sqlalchemy-rls.md) (Postgres with PostGIS and row-level security) records. The compose volume moved to `postgres18-data`, because a Postgres 17 data directory does not open under 18.

## Not checked yet

- Neon connection strings carry `sslmode=require` and `channel_binding=require`, which SQLAlchemy on asyncpg does not take. `neon.engine_uri` turns them into `ssl=require` for `DATABASE_URL` and the migration URL. TODO: not run against Neon yet.
- TODO: repeat the bounded cell import benchmark ([result](../results/2026-11-01-bounded-cell-import.md)) on Modal once ingest runs there.
- TODO: nothing starts the `ingest` function yet. The API still has to spawn it or a schedule has to run it.
- `wrangler secret bulk` creates a draft Worker with a stub script when the Worker does not exist yet, without asking when not interactive (wrangler 4.161 source, `createDraftWorker`), so bootstrap can run before the first deploy.
- TODO: the field name in `modal secret list --json`. The code accepts `Name` and `name`.
- The Modal web function sets `requires_proxy_auth`, so Modal refuses any request without a workspace proxy auth token in the `Modal-Key` and `Modal-Secret` headers before a container starts. The address follows `<workspace>--parfocal-api-web.modal.run` and is easy to guess, so this is what keeps traffic on the path through the Worker's limits and bot check. The token is made by hand in the Modal dashboard under workspace settings, Proxy Auth Tokens, and bootstrap writes it to the Worker as the secrets `MODAL_PROXY_TOKEN_ID` and `MODAL_PROXY_TOKEN_SECRET`. The Worker drops any copy a client sends. After a deploy, run `PARFOCAL_EDGE_URL=https://app.parfocal.eu PARFOCAL_API_ORIGIN_URL=<the Modal web URL> node --test apps/edge/test/deployed-api-origin.test.ts`. It expects 200 through the Worker and a 4xx at the Modal address, with no token and with a forged one. TODO: it has not run against a deploy yet, and the exact refusal status is unmeasured. Once it is known, the same check belongs in `smoke_check` in `deploy.py`.
