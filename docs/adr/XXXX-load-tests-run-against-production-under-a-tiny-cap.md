# XXXX. Load tests run against production under a tiny cap, on demand from a workflow or one command

- Date: 2026-11-16
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: TEST-010 (load test tooling), used later by OPS-012 (load and soak testing). Amends [ADR 0286](0286-load-tests-run-on-locust.md) (load tests on Locust with a target guard) and the load line of [ADR 0273](0273-test-pyramid-and-ownership.md) (the test pyramid)

## Context

ADR 0286 let load tests reach only localhost and staging hosts, and ADR 0273 said load tests run against staging and never production. [ADR 0331](0331-no-staging-environment.md) (no staging environment) dropped staging for good, so the only cloud target is production at `https://app.parfocal.eu`, which serves the API, `/tiles/` and `/rt/` through one Worker. Production holds only the owner's test data until OPS-014 (prepare production for the first real user), scales to zero and runs on $30 a month.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep load tests local only | No production risk | TEST-010's "against production on demand" can never be met, and cold starts, the Worker and R2 are never measured |
| Allow production with no cap | OPS-012 can soak without a flag | One typo runs up Modal compute or trips the Worker rate limits for the owner |
| Allow production under a tiny cap, lifted only by a named variable | A capped run costs a fraction of a cent, and OPS-012 can still lift it on purpose | One more variable to know |

## Decision

The third option. The target guard in `scripts/load/target.py` lets through localhost, `parfocal.eu` and its subdomains, `modal.run` hosts and the one exact host in `PARFOCAL_LOAD_ALLOW_HOST`. Any target that is not localhost runs only headless with a set run time, at most 2 users and at most 60 seconds per scenario, unless `PARFOCAL_LOAD_LIFT_LIMITS` is set. Staging hosts no longer pass on their name.

`scripts/load/run.py`, run as `pnpm load:run --origin URL`, runs the chosen scenarios one after another with 1 user for 30 seconds by default, writes Locust CSV files and prints one table. A scenario that made no requests because its settings are missing is reported as skipped, and a run where every scenario skipped exits with code 3. Without a service token, `ApiUser` reads only `/api/health` and `TileUser` stops on a cloud target.

The `load` workflow (`.github/workflows/load.yml`) is `workflow_dispatch` only, in the `production` environment, and calls the same command with the origin, scenarios, users and seconds as inputs. It reads the secrets `PARFOCAL_LOAD_TOKEN` and `PARFOCAL_LOAD_SESSION` and the variables `PARFOCAL_LOAD_SLIDES` and `PARFOCAL_LOAD_ROOM`, notes in the summary which scenarios skip without them and uploads the CSV files.

## Consequences

- A run at the cap against production made 53 health reads and cost about $0.002 of Modal time, the container's idle tail included ([result](../results/2026-11-16-load-scenarios-on-production.md)). Log every production run and its cost as ADR 0151 (standing approval within $30 a month) asks.
- The tile and room scenarios need a read-only service token, a few slide ids and a member session in the repository secrets before they measure production. That is decision 123 (a production token and session for the load workflow) in `docs/decisions.md`.
- OPS-012 sets `PARFOCAL_LOAD_LIFT_LIMITS` for its soak runs and must check the month's budget first. After OPS-014 production holds real data, and heavier runs move to the drill environment that ADR 0331 describes.
