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

`cache.put` refuses 206 responses, so byte-range reads of a large SVS cannot be cached as-is. If caching is needed, store each range as a full response under a synthetic key built from object, offset and length, without the token. geotiff.js requests tile-aligned ranges, so keys repeat across users. The stored copy needs `public` in `Cache-Control`, because `cache.put` refuses responses that say not to cache. `RangeCache` in `apps/edge/src/tiles.ts` does this, and it works on `workers.dev` as well as on a custom domain. A hit takes about 10 ms inside the Worker against about 60 ms for an R2 read ([result](../results/2026-11-02-tile-gateway-latency.md)). Source: ADR 0003.

## The Workers free plan runs out on tile traffic

The free plan allows 100,000 requests a day, and one pan can fetch hundreds of tiles through the gateway. Use Workers Paid ($5 a month, 10 million requests included) from day one. Source: ADR 0003.

## Free plan limits that bite

Resend's free plan allows 100 emails a day and sending pauses at the limit. Only production sends ([ADR 0005](../adr/0005-external-sends-only-in-production.md)), so that cap is the pilot's real email budget. Neon's free plan gives 100 CU-hours per project a month, which does not cover a compute that never suspends, so production on the free plan scale-to-zeroes and the first query after 5 idle minutes waits for a cold start. Modal Starter limits crons and web endpoints, which may stop every pull request from getting its own Modal environment. Source: [ADR 0004](../adr/0004-cloud-dev-resources.md).

## Modal region pinning costs 1.15 to 1.75 times

Modal's pricing page, read on 2026-11-02, lists region selection on every plan, Starter included, at 1.15 times base prices for a broad region such as `eu` and 1.75 times for a narrow one such as `eu-west`. Earlier notes said it needed the Team plan ($250 a month) at 1.5 times. Without `region=` Modal chooses where containers run, so latency from the API to Neon must be measured, not assumed. Source: https://modal.com/pricing, https://modal.com/docs/guide/region-selection and [ADR 0147](../adr/0147-cloud-provider-regions-and-pilot-cost.md) (cloud provider, regions and pilot cost).

## The cloud is open again, at the lowest possible cost

From 2026-10-08 to 2026-10-31 all work stayed local while the owner fixed the cloud side. On 2026-10-31 the owner opened Modal, Neon and the Zitadel credentials for CI again. This unblocks STACK-019 (the web framework, which needs Modal cold-start times), STACK-020 (database hosting, which needs the Neon region measurement) and IAM-001 (login provider setup from code). The owner pays for all of it and asked that it cost as little as possible and that agents be extra careful. The rules are in `AGENTS.md` under "Real infrastructure and production" and in [ADR 0115](../adr/0115-production-access-and-spend-caps.md).

## Spend caps and alerts on every service

The whole project runs on $30 a month, the compute Modal includes ([ADR 0151](../adr/0151-standing-approval-for-production-within-30-dollars.md)). Check spend before any run that costs money and pick the cheapest way.


Checked in each dashboard on 2026-10-31. A hard cap means the provider stops the work itself. An alert only sends an email and spending goes on.

| Service | Plan | Card on file | What protects the owner | Spend this cycle |
|---|---|---|---|---|
| Modal | Starter, $30 of compute included a month | Yes | Hard cap. Usage limit $30 and spend limit $0, so workloads stop when the free credits are used. Volume storage is not capped, so never keep a volume | $0.00 |
| Cloudflare R2 | R2 Paid, pay as you go past the free tier (10 GB storage, 1 million writes and 10 million reads a month) | Yes | Alert only. Cloudflare has no hard cap. The account budget alert "Default budget alert (auto-created)" emails at $1, lowered from $10 on 2026-10-31 | About $0.24 a month from 2026-11-02: 26.1 GB of public test slides under `parfocal-dev/fixtures/`, 16.1 GB past the free 10 GB at $0.015 per GB, which the owner accepted. Reads stay free |
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

## Modal replies over 2 MB cost about 1 s more

A warm Modal call returning 1.9 MB took a median 0.35 to 0.39 s from a home connection in Europe, and one returning 2.2 MB took 1.33 s, with the empty call at 0.24 s. Keep interactive replies under 2 MB, or write large ones to R2 and return a key. A T4 GPU function cold-starts in 12 to 16 s, with one sample at 40 s, and `modal billing report --for today` reads spend from the CLI. Source: [the GPU serving spike](../results/2026-11-02-gpu-serving-spike.md).

## The Worker serves every request so the CSP nonce and isolation headers reach assets

A per-request CSP nonce needs the Worker to rewrite `index.html`, and module worker scripts need COEP on their own response to run cross-origin isolated. So `apps/edge/wrangler.jsonc` sets `assets.run_worker_first` to `true` instead of the pattern list of ADR 0050 (deploy pipeline and previews), and `withSecurityHeaders` in `apps/edge/src/security-headers.ts` wraps every response. Vite writes the placeholder `PARFOCAL_CSP_NONCE` into the built HTML and the Worker swaps in a fresh nonce and sends the document with `Cache-Control: no-store`. Each environment must set the Worker var `UPLOAD_ORIGIN` to the R2 S3 endpoint origin (`https://<account>.r2.cloudflarestorage.com`), otherwise `connect-src` blocks presigned part uploads. Run `PARFOCAL_HEADERS_URL=<url> node --test apps/edge/test/deployed-headers.test.ts` after a deploy. Source: SEC-011 and [result](../results/2026-11-02-security-headers-local-check.md).

## The Worker limits login, upload writes and tiles per client address

`apps/edge/src/rate-limits.ts` runs before routing and counts `/api/auth/login` and `/api/auth/callback`, upload writes under `/api/uploads` and `/tiles/` against the free rate limiting bindings `LOGIN_LIMIT` (10 a minute), `UPLOAD_LIMIT` (120 a minute) and `TILE_LIMIT` (1,000 per 10 s) in `apps/edge/wrangler.jsonc`, keyed by `CF-Connecting-IP`. Room joins under `/rt/` count against `ROOM_LIMIT` (300 a minute) and the API's calls under `/rt-internal/` against `ROOM_INTERNAL_LIMIT` (3,000 a minute). A room also refuses the ninth socket of one person with the 429 `room-full` problem, and an internal call is refused before its body is read when its signature header is missing or malformed, and with 413 `publish-too-large` past 64 KiB. TODO: tune the limits from pilot traffic. A refused request gets the 429 `rate-limited` problem with `Retry-After`, the same contract as the API (ADR 0088, rate limits in Postgres and at the edge). Setting the Worker secret `TURNSTILE_SECRET_KEY` makes login require a Turnstile token in the `CF-Turnstile-Response` header or the `turnstile` query, so keep it unset until the web app renders the widget. Never set `TRUST_TEST_CLIENT_ADDRESS` in a deployed environment, because it lets a client choose its own address. Run `PARFOCAL_RATE_LIMIT_URL=<url> node --test apps/edge/test/deployed-rate-limits.test.ts` after a deploy, from a machine with both IPv4 and IPv6. Source: SEC-027 and [result](../results/2026-11-03-edge-rate-limits-local-check.md).
