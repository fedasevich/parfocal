# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-06

## Where we are now

The prototypes are approved for a production build and the planning is done. [BACKLOG.md](BACKLOG.md) holds 520 tasks in 37 epics from an empty repository to a pilot-ready product. The decisions taken during planning are recorded as the baseline in [ADR 0002](adr/0002-planning-baseline.md). The platform is decided in [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare for the web app, edge and storage, Modal for Python and GPUs, and Neon for Postgres. The pilot uses public slides with fake identities and optimises for cost. The STACK slots now carry these defaults but each still needs its spike. The repository `fedasevich/parfocal` holds the docs and the ADR check in CI, and no application code yet. The accounts are provisioned and listed in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

1. Milestone M0. Work through the STACK epic in [BACKLOG.md](BACKLOG.md), one ADR per slot, starting with the slots that block FOUND-001 (STACK-013 and STACK-018). Then the platform spikes that can overturn ADR 0003: STACK-019 (Modal cold start and API latency), STACK-020 (Neon region and pooler) and STACK-025 (tile latency through the Worker).
2. Create the accounts (Cloudflare with Workers Paid, Modal, Neon, Zitadel Cloud, Sentry, PostHog, Resend, later Grafana Cloud) and authorise the MCP servers in `.mcp.json`. See [knowledge/agent-tooling.md](knowledge/agent-tooling.md).
3. Then FOUND-001 to stand up the monorepo. FOUND-002 and FOUND-003 are done.
4. STACK-031 (model licensing) is the largest open risk and can run in parallel.

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
