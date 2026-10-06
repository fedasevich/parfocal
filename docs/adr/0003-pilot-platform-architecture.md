# 0003. Pilot platform architecture on Cloudflare, Modal and Neon

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: sets the defaults of STACK-019, STACK-020, STACK-022, STACK-024, STACK-025, STACK-027, STACK-028, STACK-029, STACK-030, STACK-032, STACK-033, STACK-036, STACK-037 and STACK-039. Edits FOUND-001, FOUND-009, FOUND-015, IAM-001, IAM-002, TILES-001, TILES-002, COLLAB-001, AIP-006, AIP-007, SEC-005, SEC-014, OPS-001 to OPS-004 and TEST-013.

## Context

The owner brought a deployment blueprint built on Cloudflare R2 for slides, Cloudflare Pages for the web app, Workers with Durable Objects for the backend and realtime, and Modal for serverless GPUs, with Neon as the Postgres host. The backlog defaults assumed a hyperscaler with managed Kubernetes, Temporal, Valkey and a self-run realtime server.

The constraints that shaped this decision were settled in an interview on 2026-10-06.

- One developer working with agents, so nothing that needs an always-on server to babysit.
- Cost as low as possible. Some money exists for deployment, but every fixed monthly fee must earn its place.
- The backend stays Python ([ADR 0002](0002-planning-baseline.md)).
- The pilot labs are in the EU, but the pilot holds only public slide datasets with seeded fake patient identities. There is no real PHI, so no residency pinning, DPA or BAA is needed during the pilot.

The architecture decides the default for each affected STACK slot. Each slot's spike still runs and closes its task, and a spike that disproves a default reopens it through a new ADR.

## Options considered

| Area | Chosen | Alternatives considered |
|---|---|---|
| Platform split | TypeScript on Cloudflare, Python on Modal, data in Neon and R2 | Hyperscaler with Kubernetes (the backlog default) needs far more operations work for one person. The whole API on Workers was ruled out because Python Workers run on Pyodide, which cannot load asyncpg, tifffile or OpenSlide, and Workers have a 128 MB memory limit |
| Python host | Modal base plan for FastAPI, ingest, jobs and GPU work, with no region pin | API on Fly.io or Cloud Run next to Neon is cheap and has steady latency but adds a vendor. Modal Team plan pinned to the EU costs $250 a month plus a 1.5x compute multiplier. Cloudflare Containers is unproven for this use |
| Routing | One origin. A Worker router sends `/api` to FastAPI, `/tiles` to R2, `/rt` to Durable Objects and everything else to Pages | Separate subdomains need CORS and CORP on every host, add preflights to authorised calls and make the Modal URL part of the public contract |
| Edge authorisation | Capability tokens. FastAPI checks access with RLS and signs a short-lived token scoped to tenant and slide or room, and Workers verify only the signature | Workers verifying the IdP token and looking up permissions per request need a database or a cache that goes stale on revocation |
| Identity provider | Zitadel Cloud free plan | Auth0 charges for organisations and SSO. WorkOS has a US-only data story. Better Auth puts all security-critical auth code in our hands and in TypeScript. Keycloak needs an always-on JVM |
| Session | BFF pattern. FastAPI is a confidential OIDC client, sessions and refresh tokens are stored in Postgres and the browser holds only an HttpOnly, Secure, SameSite=Strict cookie | Tokens in the SPA with PKCE expose tokens to XSS, and silent refresh in an iframe fights COEP |
| Tenancy | Shared tables with `tenant_id` and row-level security, with tenant context set by `SET LOCAL` in every transaction | Schema per tenant needs migrations looped over schemas. Database per tenant needs N migrations, N pools and a control plane, and makes cross-organisation guest access harder |
| Slide storage | R2, one bucket per environment, keys under `t/{tenant}/s/{slide}/`, presigned multipart upload, byte-range reads of the original files through the Worker gateway | Presigned GET URLs work only on the R2 S3 API domain, so they bypass the CDN cache and cannot carry COOP, COEP or CORP headers |
| Background jobs | Job, step and tile tables in Postgres, steps run by Modal `spawn`, and a Modal cron function that resumes orphaned steps from the last completed tile | DBOS assumes a long-lived process for recovery. Cloudflare Workflows would put orchestration in TypeScript. Temporal Cloud and Hatchet need always-on workers and paid plans |
| Realtime | Durable Objects with WebSocket Hibernation as ephemeral fan-out, one room per case and one per user. Postgres stays the only system of record | Durable Objects owning threads would create two sources of truth for audit, erasure and tenant isolation |
| AI serving | Batch work starts cold. Interactive segmentation is browser-first, and a separate Modal function is pre-warmed when a slow device activates the tool, then scales down after about 5 idle minutes | A GPU kept warm on a schedule costs hundreds of dollars a month. Browser-only drops tablet users |
| Infrastructure and deploys | Wrangler config, Modal app code, the Neon API from CI, GitHub Actions and a small OpenTofu module for DNS, buckets and the Zitadel and Neon projects | Everything in OpenTofu still cannot manage Modal and is slower to iterate. Pulumi adds a state backend vendor |
| Environments | Local, a preview per pull request, staging from `main` and production from tags, scaling to zero wherever the platform allows | A permanent always-on staging cluster costs money for no pilot benefit |
| Product utilities | Sentry free plan, OpenTelemetry to Grafana Cloud free tier, PostHog Cloud for flags, experiments, analytics and surveys, Resend through SMTP | PostHog for errors and logs too has less mature tracing. Self-hosting GrowthBook, Grafana and GlitchTip means always-on services |
| Frontend | The backlog defaults of STACK-001 to STACK-014, unchanged | Reviewing each one now was not needed because none depends on the platform choice |
| Keys and erasure | Application-level envelope encryption. Per-tenant data keys are wrapped by a master key held as a Modal secret, sensitive columns are AES-GCM encrypted in FastAPI, and erasure destroys the tenant key and deletes the tenant's R2 prefix | An external KMS now adds a cloud account for fake data. No column encryption would make a data migration necessary later |

## Decision

Adopt the "Chosen" column. The resulting request flow is below.

```
Browser
  app.<domain>  Worker router (one origin, adds COOP, COEP, CORP)
    /            -> Pages assets (React SPA)
    /api/*       -> FastAPI on Modal          -> Neon Postgres + PostGIS
    /tiles/*     -> token check -> R2 binding (byte ranges of originals)
    /rt/:room    -> Durable Object (WebSocket, hibernating)
  uploads        -> presigned multipart PUT -> R2 S3 API

FastAPI -> modal spawn -> ingest and GPU functions -> R2 chunks, job tables
FastAPI and Modal -> internal route -> Durable Object room -> browsers
Login: FastAPI <-> Zitadel Cloud (OIDC code flow, BFF cookie)
```

Rules that every task inherits:

1. The API package has no Modal imports. Modal wiring lives in a thin deploy module so FastAPI can move to another container host with a config change in the router.
2. Workers never query Postgres. They trust only capability tokens signed by the API.
3. Durable Objects hold no data of record. A lost message only costs a refetch.
4. Regions are not pinned during the pilot. Neon goes in the region with the lowest measured latency from Modal's API containers, measured in the STACK-020 spike. R2 gets a location hint near the users. Durable Objects use default placement.
5. Every external service sits behind an interface with a local implementation, listed in [knowledge/local-dev.md](../knowledge/local-dev.md). Replaced by [ADR 0004](0004-cloud-dev-resources.md).

### Triggers that reopen this decision

| Trigger | Action |
|---|---|
| First tenant with real PHI | Sign DPAs with every processor, plus BAAs for any US tenant (Modal, Neon and Cloudflare offer these only on enterprise or business plans). Pin regions (Modal Team plan with `region`, an R2 jurisdiction bucket with objects copied over, Durable Object jurisdiction, Neon in the pinned region). Move the master key to a KMS. Build SEC-005 |
| Modal spend above budget, or API to database latency above budget | Move FastAPI to a fixed container host next to Neon. The budgets are TODO and get set by the STACK-019 and STACK-020 spikes |
| More than 100 daily active users | Zitadel Pro ($100 a month) |
| Tile latency above the TILES-002 budget | Add the Cache API layer keyed per object and byte range |

### Known costs

Workers Paid ($5 a month) is needed from day one. Every tile read passes through the Worker, so the free plan's 100,000 requests a day would run out with a few active viewers. Everything else starts on a free plan or pure usage billing. The monthly estimate for the pilot is still TODO and stays part of STACK-029.

## Consequences

- The "Deployment" row of the decisions baseline in [BACKLOG.md](../BACKLOG.md) is superseded by this record, and a "Pilot data" row is added. The rest of ADR 0002 stands.
- Kubernetes, Helm, Argo CD, Temporal, Valkey, Centrifugo and a self-run PgBouncer leave the plan. The tasks listed at the top were edited to match.
- The repository gains `apps/edge` for the router Worker and Durable Objects. `workers/*` stays for the Python ingest and ML code, which deploys as Modal functions.
- `staging` stays as a scale-to-zero environment, because the M1 gate, the drills and the rollback tests in OPS and SEC run there.
- Vendor lock-in rises at the edge (Workers, Durable Objects) and for GPU work (Modal). This is tracked as risk R8 in [risks.md](../project/risks.md).
- Gotchas found while deciding are in [knowledge/platform.md](../knowledge/platform.md). Local equivalents for every service are in [knowledge/local-dev.md](../knowledge/local-dev.md), and the MCP servers that let agents manage each service are in [knowledge/agent-tooling.md](../knowledge/agent-tooling.md).
- Open items, all TODO: the monthly cost estimate (STACK-029), API latency and Modal cold-start budgets (STACK-019), Neon region and pooled-connection behaviour with asyncpg (STACK-020), and whether R2 supports object versioning for SEC-014.

## Sources

- Modal region selection and its plan requirement: https://modal.com/docs/guide/region-selection
- Modal pricing and region multipliers: https://www.beam.cloud/blog/modal-pricing-explained
- Modal HIPAA and BAA on the Enterprise plan: https://modal.com/blog/hipaa
- Neon HIPAA add-on on Business and Enterprise plans: https://neon.tech/docs/changelog/2025-03-14
- R2 presigned URLs work only on the S3 API domain: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Zitadel Cloud plans: https://zitadel.com/pricing
