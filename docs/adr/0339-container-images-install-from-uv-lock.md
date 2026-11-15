# 0339. Container images install from uv.lock, through exported lock files for Modal

- Date: 2026-11-15
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: FOUND-015 (container images)

## Context

`app_image()` in `workers/deploy/src/parfocal_deploy/modal_app.py` installed the version ranges from each `pyproject.toml`, so a deploy could pick up versions no test saw. The GPU pool image installed nothing and ran on `debian_slim`. [ADR 0003](0003-pilot-platform-architecture.md) (pilot platform architecture) also wants the API to run on another host, which needs a plain container image. [ADR 0280](0280-security-scans-in-ci-run-on-osv-scanner-and-zap.md) (security scans on osv-scanner and ZAP) and [ADR 0281](0281-vulnerability-slas-and-iac-scan.md) (vulnerability SLAs and IaC scan) left the container scan waiting for this task.

The alternatives for Modal were `Image.uv_sync`, which wants one project and installs workspace members as packages, a hand walk of `uv.lock`, which loses platform markers, and `uv export` into committed files.

## Decision

- `uv export --frozen --no-dev --no-emit-workspace` writes `workers/deploy/locks/app.txt` (the API and ingest with the `pdf` extra) and `workers/deploy/locks/ml.txt` (`parfocal-ml` without extras, so no torch). Both carry hashes. `pnpm images:lock` rewrites them.
- The Modal images install those files with `uv pip install --require-hashes --no-deps` through uv 0.13.8. `parfocal_deploy.image_locks` checks them against a fresh export, and `test_image_locks.py` fails when they differ from `uv.lock`.
- The GPU pool image starts from `nvidia/cuda:12.9.1-runtime-ubuntu24.04` pinned by digest, with Modal's Python 3.14 added.
- `apps/api/Dockerfile` has two stages on `python:3.14.9-slim-trixie` and uv 0.13.8, both pinned by multi-arch digest. It runs `uv sync --frozen --no-editable` for `parfocal-api` with the `pdf` extra and a new `serve` group that holds uvicorn, which only the container needs. The runtime stage drops pip, runs as uid 10001 and has a health check. Its entrypoint runs `alembic upgrade head` when `MIGRATION_DATABASE_URL` is set and then starts uvicorn.
- The `images` job in `ci.yml`, inside `ci-ok`, checks the locks, resolves them for linux/amd64, builds the API image, fails on a critical Trivy finding (`node scripts/osv-scan.ts image`), uploads a CycloneDX SBOM and starts the image on an empty compose database under the `api` profile.

## Consequences

- Every change to `uv.lock` that touches a deployed package needs `pnpm images:lock`, or the deploy tests fail.
- The real Modal image builds still happen only in `deploy.yml` on `main`, because they need Modal credentials. Pull requests prove the locks resolve for the Modal platform but do not build on Modal.
- On 2026-11-15 the API image had no critical findings. It had HIGH ones in Debian packages with no fix yet, such as util-linux and ncurses. These are not gated, and they follow the SLA in ADR 0281 once a fix ships.
