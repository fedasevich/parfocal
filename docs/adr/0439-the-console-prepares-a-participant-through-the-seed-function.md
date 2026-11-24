# 0439. The study console prepares a participant through the seed function, with the owner database URL held only by that function

- Date: 2026-11-24
- Status: Accepted
- Deciders: Claude
- Backlog: EXP-018 (the moderator prepares a participant project from the console for the code the page shows). Builds on [ADR 0435](0435-per-participant-study-projects.md) (a project per study participant) and [ADR 0438](0438-study-sessions-and-traces-upload-to-the-api.md) (study sessions upload to the API).

## Context

ADR 0435 seeds a participant's project from the command line with a code the moderator picks, through `parfocal_deploy.study`, which needs a Neon API key on the moderator's machine. The participant page makes its own random code, so on the deployed walk of v0.46.0 no project matched it and Start task stayed off with no reason. The moderator should prepare the code the page shows from the study console, with no local database keys.

The participant seed creates the study workspace and its people in platform scope. Run as the API's own database role through the pooler it fails on row security (`workspace_settings`), as the new API test showed. Every seed so far runs as the database owner: the local seed reads `MIGRATION_DATABASE_URL`, and the deployed reset passes the Neon owner URI it builds from the Neon API key.

## Options considered

- Give the API's role the rights the seed needs, through a migration that widens the platform policies. Nothing else needs those rights, and a migration that widens row security is costly to undo and easy to get wrong.
- Give the web function the Neon API key or the owner URI. Any bug in the public API would then hold owner rights over every tenant.
- Keep the owner URI in a Modal secret `parfocal-api-seed` attached only to the `seed` function. The deploy writes it on every migrating deploy from the owner URI it already builds for the migration. The API calls the seed function with only the code, the action and the seat email, and the seed function reads `SEED_DATABASE_URL` first.

## Decision

- `POST` and `DELETE /api/tenant/study-participants/{code}` need admin rights in the caller's active workspace (`manage-people` with write). The code follows ADR 0435's pattern of 1 to 32 letters, digits or dashes.
- Preparing seeds the project into the study workspace `cvut-study` as ADR 0435 has it, with the caller's own account as the seat, found by its email. An existing membership is never changed, so a moderator new to the study workspace joins it as a researcher without admin rights.
- The response names the study workspace. When the caller's active workspace is another one, the console offers a switch to it, because the participant page lists projects only in the active workspace.
- In the deployed app the web function calls the `seed` function with `remote_gen` and reads the participant's ids from the JSON line the seed prints. The owner URI lives only in `parfocal-api-seed`, and no other function holds that secret.
- In local dev and the API tests the route runs the same seed code in process, against `SEED_DATABASE_URL` when it is set and `DATABASE_URL` otherwise. `scripts/dev.sh` sets it to the owner URL.
- The participant page looks its project up by code. It asks for the project's review tasks only once the project is found, and while the code has no project it says why Start task is off.

## Consequences

- No moderator needs a Neon key. Preparing takes the seed function's cold start plus a few seconds of seeding, and the button says it can take up to a minute.
- An admin of any workspace can prepare and remove study projects. That fits the development app (ADR 0390, the deployed app is dev). It needs a narrower rule before the app holds real data (TODO).
- The owner URI in `parfocal-api-seed` follows the deploy. A rollback with `--skip-migrations` keeps the last one written, and a rotated owner password needs one migrating deploy before preparing works again.
- The fake API keeps prepared codes in localStorage, and `P-FAKE` stays prepared so the existing study specs run unchanged.
- OPS-014 (prepare production for the first real user) deletes the `parfocal-api-seed` secret and the deploy step that writes it, or narrows this rule, before the app holds real data.
