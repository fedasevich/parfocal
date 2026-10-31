# Platform gotchas

Lessons about Cloudflare, Modal and Neon as used by [ADR 0003](../adr/0003-pilot-platform-architecture.md). Entries marked "unverified" come from vendor docs and must be confirmed in this codebase.

## Tenant context must use SET LOCAL behind the Neon pooler

Neon's pooled endpoint runs PgBouncer in transaction mode, so one server connection serves many clients between transactions. A session-level `SET app.tenant_id` leaks into another client's transaction. Always use `SET LOCAL` inside the transaction that runs the query. The isolation suite (IAM-004, TEST-003) must run through the pooled endpoint, not only against local Postgres. Source: ADR 0003.

## asyncpg prepared statements behind the pooler (unverified)

asyncpg caches prepared statements per connection, which used to break with PgBouncer in transaction mode. Newer PgBouncer versions support protocol-level prepared statements. Confirm the behaviour on Neon in the STACK-020 spike and set `statement_cache_size=0` if it fails. Source: ADR 0003.

## Neon computes scale to zero

An idle Neon compute suspends and the first query after that waits for it to start. Keep autosuspend off for production and accept it for previews. Source: ADR 0003.

## R2 presigned GET URLs bypass the CDN

Presigned URLs work only on `<account>.r2.cloudflarestorage.com`, not on a custom domain, so responses are never cached at the edge and cannot carry COOP, COEP or CORP headers. Use presigned URLs for uploads only and serve reads through the Worker gateway with the R2 binding. Source: https://developers.cloudflare.com/r2/api/s3/presigned-urls/ and ADR 0003.

## The Workers Cache API does not store partial responses

`cache.put` refuses 206 responses, so byte-range reads of a large SVS cannot be cached as-is. If caching is needed, store each range as a full response under a synthetic key built from object, offset and length, without the token. geotiff.js requests tile-aligned ranges, so keys repeat across users. Source: ADR 0003.

## The Workers free plan runs out on tile traffic

The free plan allows 100,000 requests a day, and one pan can fetch hundreds of tiles through the gateway. Use Workers Paid ($5 a month, 10 million requests included) from day one. Source: ADR 0003.

## Free plan limits that bite

Resend's free plan allows 100 emails a day and sending pauses at the limit. Only production sends ([ADR 0005](../adr/0005-external-sends-only-in-production.md)), so that cap is the pilot's real email budget. Neon's free plan gives 100 CU-hours per project a month, which does not cover a compute that never suspends, so production on the free plan scale-to-zeroes and the first query after 5 idle minutes waits for a cold start. Modal Starter limits crons and web endpoints, which may stop every pull request from getting its own Modal environment. Source: [ADR 0004](../adr/0004-cloud-dev-resources.md).

## Modal region pinning needs the Team plan

Setting `region=` on a Modal function needs the Team plan ($250 a month) and adds a 1.5x multiplier for broad regions and 1.75x for narrow ones. On lower plans Modal chooses where containers run, so latency from the API to Neon must be measured, not assumed. Source: https://modal.com/docs/guide/region-selection and ADR 0003.

## The cloud is open again, at the lowest possible cost

From 2026-10-08 to 2026-10-31 all work stayed local while the owner fixed the cloud side. On 2026-10-31 the owner opened Modal, Neon and the Zitadel credentials for CI again. This unblocks STACK-019 (the web framework, which needs Modal cold-start times), STACK-020 (database hosting, which needs the Neon region measurement) and IAM-001 (login provider setup from code). The owner pays for all of it and asked that it cost as little as possible and that agents be extra careful. The rules are in `AGENTS.md` under "Real infrastructure and production" and in [ADR 0114](../adr/0114-production-access-and-spend-caps.md).

## Spend caps and alerts on every service

Checked in each dashboard on 2026-10-31. A hard cap means the provider stops the work itself. An alert only sends an email and spending goes on.

| Service | Plan | Card on file | What protects the owner | Spend this cycle |
|---|---|---|---|---|
| Modal | Starter, $30 of compute included a month | Yes | Hard cap. Usage limit $30 and spend limit $0, so workloads stop when the free credits are used. Volume storage is not capped, so never keep a volume | $0.00 |
| Cloudflare R2 | R2 Paid, pay as you go past the free tier (10 GB storage, 1 million writes and 10 million reads a month) | Yes | Alert only. Cloudflare has no hard cap. The account budget alert "Default budget alert (auto-created)" emails at $1, lowered from $10 on 2026-10-31 | $0.00, all inside the free tier |
| Cloudflare Workers | Workers Free | Yes | Hard cap by plan. Requests past the daily free limit fail instead of billing | $0.00 |
| Cloudflare zone `parfocal.eu` | Free | Yes | Capped by plan | $0.00 |
| Neon | Free (`free_v3`), billed through the Vercel Marketplace | No | Hard cap by plan: 1 GB storage and 100 CU-hours per project a month, then the compute stops | $0.00 |
| Vercel team "fedasevich's projects" | Hobby | No | Capped by plan, and no card means nothing can be charged | $0.00 |
| Zitadel Cloud | Free, team still named "pathocal" | Not checked | Capped by plan at 100 daily active users | $0.00 |
| GitHub `fedasevich` | GitHub Pro through education benefits, $0 a month | Not checked | Budgets of $0 that block usage for Actions, Packages, Codespaces and Git LFS, a $5 budget for AI credits, and included usage alerts on. The public repository's Actions minutes are free | $13.66 used, all covered by included usage |
| Domain `parfocal.eu` at Endora | Yearly renewal | Not checked | A known yearly cost, nothing to alert. TODO: write down the renewal date and price | |

Sentry, PostHog, Resend and Grafana have no accounts yet. Set a cap or an alert at the lowest amount on the day each is created and add a row here.

How to check spend quickly: Modal at `modal.com/settings/fedasevich/usage`, Cloudflare at Manage account, Billing, Billable usage, Neon through the Vercel MCP tool `list_integration_configurations` (its `billingData`), Vercel at the team's Settings, Billing, and GitHub at Settings, Billing and licensing.

## Modal stops deploys at the workspace spend limit

On 2026-10-08 `modal deploy -e dev` failed with "Workspace … has exceeded its spend limit" before building anything. Deploys and runs in every environment stop until the owner raises the limit or the billing period resets, so CI deploys to Modal would fail the same way. Source: STACK-019 log entry.

Since 2026-10-31 the spend limit is $0 on purpose, so compute stops when the $30 of free credits is used. See the table above.
