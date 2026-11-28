# Billing audit of every paid service on 2026-11-28

- Date: 2026-11-28
- Backlog: OPS-009 (storage lifecycle and cost controls)
- Method: reads only. Modal CLI (`modal billing summary`, `modal billing report --for "this month" --show-resources`, app, container, volume and environment lists), Wrangler and the Cloudflare API (bucket list, info, lifecycle and `/r2/metrics`, GraphQL operation counts, no object bodies), the Neon MCP (projects, branches, project details), the Vercel MCP (team, projects, integrations, charges) and `gh api` (caches, artifacts, runs, runners). Nothing was changed.

The owner asked on 2026-11-26, after the 9 dollar R2 Infrequent Access charge, to check every service for money spent on nothing. Apart from about $0.01 a month at Cloudflare, nothing costs money for no use.

| Service | Billed this cycle | Waste found |
|---|---|---|
| Modal | Metered $33.68 from 2026-11-02 to 2026-11-27, of which $19.23 egress is covered by the free egress allowance and $14.45 by credits, so $0.00 billed. Cycle start TODO. | None. Apps `parfocal-api` and `parfocal-gpu-pool` in `main`, every function at `min_containers` 0, no volumes, hourly crons on `ingest` and `events` as documented, environment `staging` gone. |
| Cloudflare R2 | Estimated $0.48 a month storage (42.09 GB, 10 GB free, $0.015 per GB), plus the $9.01 Infrequent Access charge already incurred. Operations far under the free tier (about 70k writes and 250k reads in November). The billable usage page is not readable with the agent token. | `parfocal-drill-lifecycle` (EU) still holds one 56 byte Infrequent Access object, about $0.01 a month until about 2026-12-24, and its rule `drill-tier-tenant-objects-by-date` is still on. The owner deletes the bucket, as decisions.md says. |
| Cloudflare Workers and zone | $0.00, plan assumed Free (the subscription call returned 403, TODO) | None. One Worker `parfocal-edge`, zone `parfocal.eu` on Free, no Pages, D1, KV or Queues. |
| Neon | $0.00, free plan | None. `still-field-25034761` (Frankfurt) has one branch `main`, 57.6 MB, about 28 CU hours of the 100 free. `soft-pine-86468744` is gone and no test branches are left. |
| Vercel | No charges (the charges call returned 404), plan TODO | None for Parfocal, which has no Vercel project. |
| GitHub | Public repository, Actions minutes free. Billing API needs the `user` scope, TODO. | None billed. 448 caches (10.5 GB) and 3,058 artifacts (4.3 GB), mostly `zap-baseline` and `flaky-*`, could have a shorter retention. |

Bucket state: `parfocal-dev-eu` 51,892 objects and 42.1 GB in Standard, `parfocal-prod` empty, `parfocal-tfstate` 30 kB, all with only the abort incomplete uploads rule. `parfocal-dev` (US) no longer exists.

What to watch: Modal egress. `parfocal-api` sent about 480 GiB from 2026-11-19 to 2026-11-23 (about $19 at $0.04 per GiB), near zero since. The free allowance covered it, but a repeat past the allowance would bill. TODO: find what streamed out that week.
