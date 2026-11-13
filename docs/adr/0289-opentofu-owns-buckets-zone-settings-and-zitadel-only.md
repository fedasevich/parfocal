# 0289. OpenTofu owns buckets, zone settings and Zitadel only, and Neon, Modal, Workers and the app hostnames stay with their own tools

- Date: 2026-11-13
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: OPS-001 (base infrastructure as code), OPS-002 (deploy definitions). Amends [ADR 0003](0003-pilot-platform-architecture.md) (pilot platform architecture) and closes the TODO in [ADR 0050](0050-deploy-pipeline-and-previews.md) (deploy pipeline and previews)

## Context

ADR 0003 gave OpenTofu "DNS, buckets and the Zitadel and Neon projects", and ADR 0050 left a TODO for OPS-001: do the Neon projects move under OpenTofu. OPS-001's own text also lists DNS, certificates, the database, registries and Kubernetes, which predate ADR 0003. The line between OPS-001 and OPS-002 has to be drawn before OPS-002 starts.

Facts checked on 2026-11-13:

- Neon's documentation calls its Terraform provider community-maintained (`kislerdm/neon`). Neon publishes no provider of its own.
- The Neon project `parfocal` sits in an organisation that Vercel created and bills, next to four of the owner's other projects.
- The Cloudflare token `parfocal-tofu` has no Workers permission, on purpose. No Worker exists yet.
- The zone holds only records for the owner's old web host: proxied A records for the apex, `www` and a wildcard, a CNAME, four MX records and two TXT records.
- The Modal provider does not exist. Modal is driven by its CLI.

## Options considered

1. Everything possible in OpenTofu: Neon projects and branches through the community provider, Workers routes and DNS records for the app hostnames through the Cloudflare provider. One tool, but database passwords land in the state, a provider with one maintainer can destroy the production database on a bad diff, the token needs Workers rights, and Wrangler and OpenTofu would both own the Worker.
2. OpenTofu only for durable resources that cost nothing and that no deploy tool creates. Each vendor's deploy tool owns what it deploys.
3. No OpenTofu, scripts only. Loses the plan and the drift check for the resources where they matter most, the buckets and the login apps.

## Decision

Option 2.

| Thing | Owner | Why |
|---|---|---|
| R2 slide buckets and their rules, zone settings, Zitadel project and apps | OpenTofu, OPS-001 | Durable, free, and a plan shows drift |
| Neon projects, branches, roles and connection strings | The Neon API or `neonctl` from an idempotent script, OPS-002 | No vendor provider, passwords stay out of the state, branches are runtime objects (ADR 0050) |
| Workers, static assets, Durable Objects and the hostnames `staging.parfocal.eu` and `app.parfocal.eu` | Wrangler, OPS-002. The hostnames are Workers Custom Domains, for which Cloudflare creates the DNS record and the certificate | One owner per Worker. The policy check refuses a DNS record for these names in OpenTofu |
| Certificates | Cloudflare Universal SSL, nothing to declare | Free. Advanced Certificate Manager is paid and not needed for first-level hostnames |
| Modal apps, environments and secrets | The Modal CLI, OPS-002 | No provider |
| Existing DNS records of the old web host | Nobody yet. Not imported | Their fate is the owner's, decision 89 in `docs/decisions.md` |
| Registries and Kubernetes | Not built | ADR 0003 removed them |

The Neon layout of ADR 0050 stands: project `parfocal` with branches `main` and `staging`, and project `parfocal-preview`. Whether the existing project keeps its region and Postgres version is decision 90 in `docs/decisions.md`.

## Consequences

- OPS-002 reads `tofu.sh <root> output -json` for the bucket, origin and login app of an environment, and creates the rest with Wrangler, Modal and the Neon API.
- OPS-002 needs credentials that OPS-001 did not: a Cloudflare token with Workers rights, a Neon API key and a Modal token, as CI secrets. They are decision 88 in `docs/decisions.md`.
- Mail records for `parfocal.eu` (OPS-013, email routing for support and security) can be added to `global` later, since `cloudflare_dns_record` is on the free list.
- If Neon ever publishes its own provider, moving the projects under OpenTofu is an import, not a rebuild.
