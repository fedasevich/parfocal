# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-06

## Where we are now

The prototypes are approved for a production build and the planning is done. [BACKLOG.md](BACKLOG.md) holds 558 tasks in 38 epics from an empty repository to a pilot-ready product. The decisions taken during planning are recorded as the baseline in [ADR 0002](adr/0002-planning-baseline.md). The platform is decided in [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare for the web app, edge and storage, Modal for Python and GPUs, and Neon for Postgres. The pilot uses public slides with fake identities and optimises for cost. The STACK slots now carry these defaults but each still needs its spike. The repository `fedasevich/parfocal` holds the monorepo skeleton (FOUND-001), with pnpm, Turborepo, TypeScript 7 and Biome on the TypeScript side and Python 3.14 with uv on the Python side ([ADR 0006](adr/0006-monorepo-tooling.md), [ADR 0007](adr/0007-python-tooling.md)). Three CI workflows check the docs, the infra code and the workspace. The API has typed settings, client selection by `APP_ENV`, RFC 9457 errors, a local Postgres stack with row-level security, and tenants and organisations with a table-driven isolation suite ([ADR 0024](adr/0024-workspaces-are-tenants.md)). Login through Zitadel works with server-side sessions ([ADR 0025](adr/0025-zitadel-bff-login.md)) and is tested end to end in CI. People hold memberships with one of the UX kit's roles in one or more workspaces and switch between them, and every route declares its permission ([ADR 0026](adr/0026-roles-and-permission-matrix.md)). An append-only audit log with a hash chain per workspace records permission and workspace changes and sign-ins, naming people only by erasable pseudonyms ([ADR 0027](adr/0027-audit-log-hash-chain-in-postgres.md)). Every column carries a data class, and a generated data map lists them ([ADR 0028](adr/0028-data-classes-on-columns.md)). Integrations reach a workspace through service accounts with scoped, revocable API tokens ([ADR 0029](adr/0029-service-accounts-with-own-api-tokens.md)). People join workspaces through invitations bound to their verified email ([ADR 0030](adr/0030-invitations-bound-to-verified-email.md)). Sessions lock after the workspace's idle time and people can end their other sessions ([ADR 0031](adr/0031-idle-lock-from-explicit-activity.md)). Who signs alone, who supervises and whether a signature is on file are decided by one rule ([ADR 0032](adr/0032-signing-rights-on-the-membership.md)). The web app has a Vite build with typed public config but no screens yet. The accounts are provisioned and listed in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

Work stays local until the owner fixes the cloud side. No Modal, Neon, staging or production changes, see [knowledge/platform.md](knowledge/platform.md). Zitadel Cloud may be used again since 2026-10-13. The UI is not final, so no UI work either.

1. IAM-021 (the lock screen) needs the final UI. CASES-001's encrypted identifiers depend on SEC-004 and STACK-037. IAM-001 (Zitadel config recreated from scratch in CI) needs a decision on CI credentials. STACK-020 only lacks the Neon region measurement.
2. STACK-019 needs a Modal run for its cold-start numbers and waits for the owner. FOUND-014 is on hold, and FOUND-019 waits for the final UI.

## Index

| File | What it holds |
|---|---|
| [BACKLOG.md](BACKLOG.md) | Every task with checkboxes, the Definition of Done and the decisions baseline |
| [log.md](log.md) | Dated log of what was done |
| [project/overview.md](project/overview.md) | The product, users, scope, design sources and the POC's role |
| [project/roadmap.md](project/roadmap.md) | Milestones M0 to M6 and their status |
| [project/risks.md](project/risks.md) | Risk register |
| [project/poc-reference.md](project/poc-reference.md) | Where the POC lives, with full links to every POC doc |
| [adr/](adr/README.md) | Decision records |
| [results/](results/README.md) | Measurements, benchmarks, evaluations and studies |
| [knowledge/](knowledge/README.md) | Durable lessons and gotchas by topic |
| [reference/permissions.md](reference/permissions.md) | The role and permission matrix, generated from the API code |
| [reference/data-map.md](reference/data-map.md) | The data class of every database column, generated from the table models |
