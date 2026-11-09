# 0280. Security scans in CI run on osv-scanner and a ZAP baseline

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: TEST-014 (security tests in CI). Leaves the severity SLAs and weekly report to SEC-015 (vulnerability management).

## Context

TEST-014 asks for a DAST baseline scan on preview environments and dependency and container scans, done when a known vulnerable dependency fails CI. [ADR 0273](0273-test-pyramid-and-ownership.md) (test pyramid and ownership) puts the dependency and container scans on the pull request path. The project runs on hosted runners with no paid scanning service and no new secrets. FOUND-014 (dependency and licence scanning) is on hold, so nothing scanned the lockfiles before this. No Dockerfile exists yet, because FOUND-015 (container images) is still open. No preview environment exists either.

The alternatives were `pnpm audit` plus `pip-audit`, one tool per ecosystem with two allowlist formats, or osv-scanner, which reads `pnpm-lock.yaml` and `uv.lock` in one run from the free OSV database and keeps one allowlist with an expiry per entry. For DAST, the options were the ZAP baseline scan or nothing until a preview environment exists.

## Decision

- osv-scanner 2.7.1, downloaded with a pinned checksum by `.github/actions/install-osv-scanner`, scans both lockfiles. `scripts/osv-scan.ts` is the single entry point, with `scan`, `self-test` and `allowlist` commands.
- The `dependency-scan` job in `ci.yml` runs on every push and pull request and is part of `ci-ok`. It takes seconds and depends only on the lockfiles and the OSV database, so a new advisory against a locked package blocks merging, which is the point of the task. The `security` workflow runs the same scan every Monday so advisories show up without a push.
- Proof that a known vulnerable dependency fails CI: `self-test` scans `scripts/fixtures/security/known-vulnerable.requirements` (jinja2 2.10) as a `requirements.txt` and passes only when osv-scanner exits with its findings code and reports GHSA-462w-v97r-4m45 (jinja2 sandbox escape). The fixture has a non-standard name so GitHub's dependency graph does not alert on it, and it sits in a folder without an allowlist. The app gains no vulnerable package.
- `osv-scanner.toml` allowlists the 19 advisories present on 2026-11-09 (undici, fast-uri, glob, minimatch, deepmerge, fflate, image-size, zod and certifi), each with a reason and `ignoreUntil = 2026-12-09`. An expired entry is reported again and fails the scan. `scripts/osv-scan.test.ts` in `test:guards` checks that every entry has a reason and an expiry no more than 90 days ahead.
- The `dast-baseline` job in the `security` workflow builds the web app on the fake API, serves it with `vite preview` and runs the ZAP baseline (passive) scan from a pinned image. `.zap/rules.tsv` fails on every passive rule except ZAP's informational ones and five header rules that `apps/edge/src/security-headers.ts` sets in production but `vite preview` does not. The job is off `ci-ok` because it is slower and its target is not the production stack.

## Waiting

- The container scan waits on FOUND-015 (container images). When the API image exists, its build job adds a Trivy image scan. Trivy is not added now because there is nothing to scan.
- The DAST scan against preview environments waits on a preview environment. When one exists, `dast-baseline` points at its URL instead of `vite preview`, and the five header rules move from IGNORE to FAIL.

## Consequences

- On 2026-12-09 the allowlist expires and `dependency-scan` turns red until the packages are upgraded or each entry is renewed with a new reason. certifi (CVSS 9.1) has a fixed release and is the first to upgrade.
- An outage of the OSV API fails `dependency-scan`. A rerun is the fix, and if it recurs the job can move off `ci-ok`.
- FOUND-014 can resume with only the licence allowlist and update automation, because vulnerability scanning of both lockfiles is done here.
