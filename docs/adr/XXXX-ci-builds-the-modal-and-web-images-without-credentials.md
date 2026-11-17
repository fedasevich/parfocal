# XXXX. CI builds the Modal and web images without credentials

- Date: 2026-11-17
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: FOUND-018 (contract check and image builds in CI), FOUND-015 (container images)

## Context

FOUND-018 wants the web, API and Modal image builds in jobs that `ci-ok` requires. The API image already builds in the `images` job, and the generated-client check already runs in `test`. [ADR 0339](0339-container-images-install-from-uv-lock.md) (container images install from uv.lock) left one gap: the Modal images build only in `deploy.yml`, which is paused, so a pull request proved only that the locks resolve with `uv pip install --dry-run`. A dry run never downloads a wheel, never builds an sdist and never imports the code, so a missing runtime dependency or a wheel that does not load on the base still reaches the deploy.

A real Modal build needs a Modal token. The only Modal environment is production (`main`), whose token lives in the GitHub `production` environment, so a pull request job would run pull request code with production credentials and spend from the $30 a month. Reading Modal's private image internals to replay its build steps elsewhere would break on any client upgrade.

## Decision

- A `modal-images` job, a matrix of `app` and `ml` inside `ci-ok`, runs each image's check inside the base Modal builds that image from, on the hosted linux/amd64 runner: `python:3.14.9-slim-trixie` pinned by digest for the app image, the same base as the API Dockerfile, and `nvidia/cuda:13.3.1-cudnn-runtime-ubuntu24.04` pinned by the `CUDA_BASE` digest in `parfocal_ml.modal_pool` for the GPU pool image, with uv's Python 3.14 standing in for Modal's `add_python`.
- `python -m parfocal_deploy.image_check app|ml` creates a Python 3.14 venv, installs the image's lock with uv 0.13.8 and `--require-hashes --no-deps` as Modal does, then imports the entry modules with only the deployed sources on the path. The app image imports `parfocal_api.app` and `parfocal_ingest.__main__`. The ML image imports `parfocal_ml.modal_pool` and both map workers.
- `test_image_check.py` fails when the check and the Modal definitions disagree on the lock files, the install options, the Python version, the deployed sources or the base image digests written in `ci.yml`.
- A `web-build` job inside `ci-ok` builds the web app with `PARFOCAL_PUBLIC_APP_ENV=prod`, as the deploy does, and bundles the edge Worker with those assets through `wrangler deploy --dry-run --env production`, which needs no Cloudflare token.
- The client drift check stays in `test`. It was proven once locally: adding a field to the API's `Health` model and running `pnpm api:generate` changed `openapi.json`, `api.ts` and `api.msw.ts`, so the check's `git status` test fails such a pull request.
- No job builds on Modal itself. If the owner later wants that, it gets its own Modal environment and token in repository secrets, runs `Image.build` on pushes to `main` only, and gates each step on the token being present, because a job-level `if` cannot read secrets.

## Consequences

- Pull requests that change code now install and import every Modal image on its real base for linux/amd64, which replaces the "pull requests do not build on Modal" consequence of ADR 0339 for everything except Modal's own builder.
- Modal's builder can still differ from the check. It installs its client into the image and may pick a different Python patch release than uv. A failure there shows up only in `deploy.yml`.
- The `ml` leg pulls the CUDA base, a few gigabytes, on every code pull request. If that becomes slow, cache the layer or move the leg to pushes to `main`.
- The image jobs skip on pull requests that change only docs, through the `changes` job, like the other heavy jobs.
- The TEST-040 (API container under the end-to-end suite) job will build the API image again. Sharing it through an artifact or a registry cache is left to that task.
