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

## Local only until the owner fixes the cloud

Since 2026-10-08 the owner has asked that nothing touch the cloud: no Modal deploys or runs, no Neon branches, no OpenTofu applies and no staging or production deploys. The owner is fixing the cloud side. Build and test against local services, write `TODO` for numbers that need the cloud, and ask before touching it again.

## Modal stops deploys at the workspace spend limit

On 2026-10-08 `modal deploy -e dev` failed with "Workspace … has exceeded its spend limit" before building anything. Deploys and runs in every environment stop until the owner raises the limit or the billing period resets, so CI deploys to Modal would fail the same way. Source: STACK-019 log entry.
