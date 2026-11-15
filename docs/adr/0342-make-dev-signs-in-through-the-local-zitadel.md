# 0342. make dev signs in through the local Zitadel by default

- Date: 2026-11-15
- Status: Accepted
- Deciders: claude (FOUND-009 parallel run)
- Backlog: FOUND-009

## Context

FOUND-009 (local development environment) asks that one command take a new machine to the logged-in home screen in under 10 minutes. [ADR 0004](0004-cloud-dev-resources.md) (cloud dev resources) put development identity on the shared Zitadel Cloud instance. A new machine has none of its client secrets, and getting them means asking the owner, which already breaks the 10 minutes. The end-to-end tests already run a local Zitadel in Docker (`infra/local/zitadel-up.sh`) that OpenTofu configures with an app and a verified test user.

## Options considered

| Option | For | Against |
|---|---|---|
| Zitadel Cloud from `.env`, as ADR 0004 says | Same login pages as production | Needs the owner's secrets on every new machine, and every developer shares one instance |
| The local Zitadel from the e2e stack | No secrets, works offline after the first pull, the same code the e2e tests trust | About 640 MB more images and one more container pair while it runs |

## Decision

`make dev` starts the local Zitadel and signs in as `e2e-pathologist@parfocal.test`, whose password `zitadel-up.sh` generates into `.zitadel/test-password`. `PARFOCAL_DEV_IDENTITY=cloud make dev` skips it and uses the Zitadel Cloud settings in `.env`, which keeps ADR 0004's path for the owner. The cold run took 62 s ([result](../results/2026-11-15-make-dev-cold-start.md)).

## Consequences

ADR 0004 stays right for the dev bucket and for anyone who sets `PARFOCAL_DEV_IDENTITY=cloud`. Its identity row is narrowed, not reversed. The compose files and `zitadel-up.sh` take their ports and project names from `PARFOCAL_*` variables, with today's values as defaults, so a second stack can run beside the shared one.
