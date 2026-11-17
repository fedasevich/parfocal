# 0368. The end-to-end suite runs the API and ingest containers

- Date: 2026-11-17
- Status: Accepted
- Deciders: claude (TEST-040 parallel run)
- Backlog: TEST-040

## Context

TEST-040 (API container under the end-to-end suite) asks that the specs in `apps/e2e` run against the API image from FOUND-015 (container images) and the local Zitadel from TEST-039 (local Zitadel for the end-to-end suite), behind one `pnpm stack:up`, with the web app still on vite dev, and that an upload is ingested with no manual ingest call. Until now Playwright started the API with `uv run uvicorn` and `upload-into-project.spec.ts` ran `python -m parfocal_ingest` by hand after each upload.

Two facts shape the stack. The browser and the API must see the same Zitadel issuer and the same storage endpoint, because the API checks the token issuer and signs upload URLs for a host the browser then calls. Both are `localhost` addresses on the host. Second, nothing starts ingest in production yet ([knowledge/deploy.md](../knowledge/deploy.md) has the TODO). An upload only adds a row to `jobs`, and a worker that polls the table claims it ([ADR 0044](0044-background-jobs-and-workflows.md), background jobs in Postgres tables).

## Options considered

1. Run the API container with host networking, so `localhost` inside it is the host. Docker Desktop on the Mac supports host networking only behind an opt-in setting, so it would work in CI and fail on the owner's machine.
2. Give the API internal addresses (`zitadel:8080`, `storage:9000`) and add separate public settings for the issuer and the signing host. That changes production code paths only to suit the test stack, which is the opposite of what the task wants to prove.
3. Keep the API on the same `localhost` addresses and add a small `socat` sidecar that shares the API container's network namespace and forwards `127.0.0.1:<zitadel port>` to `zitadel:8080` and `127.0.0.1:<storage port>` to `storage:9000`. The API runs exactly as configured in production style, and TCP forwarding keeps the `Host` header, so signatures and Zitadel's host check still match.

For ingest, the choices were a resident worker container that polls, or teaching the API to start a worker on upload. The second is the open production question and belongs to the deploy work, not to a test stack.

## Decision

Option 3. `infra/local/stack.compose.yaml` layers three services on `compose.yaml`: `server` (the API image, migrating on start through `docker-entrypoint.sh`), `loopback` (the `socat` sidecar) and `ingest` (a new image from `workers/ingest/Dockerfile`, built the same way as the API image from `uv.lock`, running `python -m parfocal_ingest --poll 0.5` with no idle exit). The API joins the Zitadel compose network as an external network. `infra/local/stack-up.sh` (`pnpm stack:up`) starts Zitadel, builds and starts the stack, copies the `small` fixture group into MinIO under `fixtures/` and runs the showcase seed. `pnpm stack:down` stops both projects. Playwright no longer starts an API and fails early with a hint when the API container does not answer.

An upload starts ingest because the completed upload enqueues an `ingest` job and the resident worker claims it within half a second. The upload spec now waits on `/api/uploads/{id}/status` instead of running the worker.

## Consequences

- The deploy image, migrations on start and the `test` settings now run under a browser on every CI run, with no secrets.
- The ingest image is new and is not yet scanned or built in the `images` job. TODO: add it there when the Modal image question in FOUND-015 is settled.
- The edge Worker stays out, as the task says. Tiles, realtime and edge headers are still not covered by the suite.
- Production still has no trigger for the ingest function. The resident worker here proves the job path, not the trigger.
- The SSO spec runs `parfocal_api.tenant_command` inside the API container with `docker compose exec`, and passes the IdP metadata on stdin, since the host no longer holds the API settings.
- The first full run exposed a race that the old setup hid: a fresh Zitadel can answer 404 when the API opens the first session of a user it has just created. Sign-up now retries that first session on a 404 for up to about 3 s (`NEW_USER_WAITS` in `password_login.py`) and still answers `identity-unavailable` after that.
- A parallel session runs its own stack by setting `COMPOSE_PROJECT_NAME`, `PARFOCAL_E2E_PORT` and the `PARFOCAL_*_PORT` variables.

## Reopen when

- Docker Desktop turns host networking on by default, which would remove the sidecar.
- Production gets an ingest trigger other than polling, which the stack should then use too.
