# XXXX. A Modal environment and a tenant key prefix per preview

- Date: 2026-11-16
- Status: Proposed
- Deciders: Claude (OPS-003 agent), for the owner to confirm at merge
- Backlog: OPS-003 (environments). Amends [ADR 0050](0050-deploy-pipeline-and-previews.md) (deploy pipeline and previews) after [ADR 0331](0331-no-staging-environment.md) (no staging environment).

## Context

ADR 0050 planned one shared Modal environment `preview` with an app and a secret named per pull request, previews deployed from the staging Wrangler block, a Neon branch `pr-<n>` from a branch `base`, and a Worker that adds `STORAGE_PREFIX` to every key. ADR 0331 removed staging, the Modal app code names its app `parfocal-api` and its three secrets with fixed names, and nothing in the API read a storage prefix.

## Options considered

| Option | For | Against |
|---|---|---|
| A. Shared environment `preview`, app and secret per pull request | Two Modal objects per preview | The app and secret names are fixed in `modal_app.py`, so every name would need a parameter, and teardown must find each object |
| B. One Modal environment `pr-<n>` per pull request | The existing deploy and bootstrap run unchanged with a synthesized target, teardown is one `modal environment delete`, and Modal allows 1500 environments | One more object per preview to list in the nightly sweep |
| C. Prefix every key in the Worker only | One place | The API writes uploads, results and exports through S3, so they would still land in production's `t/` |
| D. Prefix only tenant keys (`t/...`) in both the API object store and the Worker, from `STORAGE_KEY_PREFIX` and `STORAGE_PREFIX` | Uploads, tiles and results of a preview stay under `previews/pr-<n>/`, and seeded slides keep reading the shared `fixtures/` | Two code paths to keep in step, tested on both sides |

## Decision

Option B and option D.

- A preview is the Worker `parfocal-edge-pr-<n>` deployed from the top-level Wrangler config with `--name`, never with `--env production`, whose route is `app.parfocal.eu`. It lives at `https://parfocal-edge-pr-<n>.<subdomain>.workers.dev`.
- The API runs in Modal environment `pr-<n>` with the usual app and secret names. Only `parfocal_deploy.modal_app` is deployed, not the ML pool, and it has no cron.
- The Neon branch `pr-<n>` is made in the project named by the `preview` GitHub environment from the branch in `PREVIEW_NEON_PARENT`, or the project's default branch, with `expires_at` 7 days ahead that each push moves. A new branch is migrated and seeded with the showcase data.
- `STORAGE_KEY_PREFIX` on the API and `STORAGE_PREFIX` on the Worker must match `previews/pr-<n>/`, production refuses any prefix, and only keys under `t/` are moved.
- Every name comes from the pull request number in one function. Each delete checks the exact name again and refuses `main`, `dev`, `fixtures/`, `previews/`, another pull request's name and any Neon branch marked default or protected.
- Both workflows run only when the repository variable `PREVIEWS` is `true`, only for pull requests from this repository, and never through `pull_request_target`. The teardown runs from the default branch, so it is reviewed code. More than 5 previews at once are refused.

## Consequences

- Closing a pull request deletes the Worker, the Modal environment with its apps and secrets, the Neon branch and the objects under `previews/pr-<n>/`. A nightly sweep removes what a missed close left, and it does nothing when it cannot list open pull requests.
- Preview SLI batches written by the Worker still go to the shared SLI prefix. TODO: move them under the preview prefix if they ever disturb production counts.
- TODO: confirm that deleting the Worker also removes its Durable Object storage, the flags `modal environment delete --yes` and `gh pr comment --create-if-none`, and the Zitadel glob redirect of ADR 0050, on the first real preview run.
