# Result: four places the API and database could live, where moving both to the EU now costs less than pinning the API in the US and still fits once real data arrives

- Date: 2026-11-17
- Backlog: OPS-030 (a warm API call answers in under 300 ms). Feeds decision 140 (moving the API and database to one region) in [decisions.md](../decisions.md) and OPS-020 (pin storage, database and Modal functions per region)
- Kind: desk research with prices and facts read from vendor pages on 2026-11-17. Nothing was run and no cloud account was touched
- Commit: 8139c379
- Environment: none. Earlier measurements come from [warm API round trips](2026-11-17-warm-api-round-trips.md), [production latency](2026-11-17-production-latency.md) and [API cold start](2026-11-17-api-cold-start.md)
- Data: none

## Question

Where should the API on Modal and the database on Neon live, given users in Europe, real medical slides later and $30 a month in total?

## Facts read from the vendors

Modal ([region selection](https://modal.com/docs/guide/region-selection), [pricing](https://modal.com/pricing), [data residency](https://modal.com/docs/guide/data-residency), [security](https://modal.com/docs/guide/security), [release notes](https://modal.com/docs/sdk/py/releases)):

- A region pin multiplies base prices by 1.15 for a broad region (`us`, `eu`, `ap`) and by 1.75 for a narrow one. Narrow names include `us-east`, `us-central`, `us-south`, `us-west`, `eu-west`, `eu-north`, `eu-south` and `uk`. Region selection is on every plan, Starter included.
- The multiplier covers the whole container. Modal's own example multiplies the sum of GPU, CPU and memory by 1.75.
- `region=` is set per function, so the web function can be pinned while ingest, events and GPU functions stay unpinned at base price.
- Modal does not publish which clouds or cities are behind `eu-west` or `eu`. A pinned function is never moved, even when the region has no capacity, and Modal says broader regions give better cold starts.
- All inputs enter through Modal's servers in Virginia (`us-east`) by default. `routing_region=` moves the entry to `us-west`, `eu-west` (Dublin) or `ap-south`. It can be set only on a function's first deployment, so an existing function needs a new name. A function routed outside `us-east` can be called only with `.remote()`, `.map()` or HTTP, not `.spawn()`. Release 1.4.3 (2026-05-18) called regional routing a Public Beta. The repository uses Modal 1.6.3.
- Even with an EU pin, logs, secrets, images, volumes, spawned payloads and payloads over 2 MiB are stored in the United States. Web payloads of 2 MiB or less stay in the routing region.
- Base prices are $0.0000131 per core-second and $0.00000222 per GiB-second, a T4 is $0.000164 and an L4 $0.000222 per second. Starter includes $30 of credit a month. HIPAA needs the Enterprise plan. A data processing addendum is on Modal's Trust Center.

Neon ([regions](https://neon.com/docs/introduction/regions), [pricing](https://neon.com/pricing), [moving between projects](https://neon.com/docs/import/migrate-from-neon), [compliance](https://neon.com/docs/security/compliance), [latency table](https://neon.com/faster)):

- EU regions are Frankfurt (`aws-eu-central-1`) and London (`aws-eu-west-2`). London is outside the EU. Azure regions are closed to new projects.
- A project's region cannot be changed. Moving means a new project in the new region, then `pg_dump -Fc | pg_restore` over unpooled connections, then switching the connection string. The page states no downtime figure.
- Free gives 100 CU-hours and 1 GB per project a month, 100 projects, a compute that always suspends after 5 minutes and 6 hours of restore history. Launch has no monthly minimum, costs $0.106 per CU-hour and $0.35 per GB-month, keeps 7 days of history and lets scale to zero be turned off. The pricing page states no price difference between regions.
- Neon's table gives about 1 ms per round trip and about 3 ms per connect when app and database share a region.

Cloudflare R2 ([data location](https://developers.cloudflare.com/r2/reference/data-location/)): the bucket's `eeur` location in `infra/tofu/modules/environment/main.tf` is a best-effort hint. Only the `eu` jurisdiction guarantees storage in the EU, and it cannot be set on an existing bucket.

## Latency between the candidate pairs

Modal does not say where its containers sit, so region pairs are taken from Microsoft's median round-trip table between Azure regions for the 30 days ending 2026-07-30 ([source](https://learn.microsoft.com/en-us/azure/networking/azure-network-latency)). It is a proxy. Both containers measured earlier ran on Azure, and the proxy agrees with those two measurements.

| Pair | Round trip | Source |
|---|---|---|
| Modal Azure `eu-west` to Neon Virginia | 89 ms | Measured, warm API round trips result |
| Modal Azure `us-west` to Neon Virginia | 60 ms | Measured, same result |
| Azure West Europe to East US, and West US to East US | 85 and 67 ms | Azure table |
| Modal `us-east` to Neon Virginia | 1 to 9 ms | Neon's same-region figure, and Azure's two Virginia regions at 8 to 9 ms |
| Modal in the EU to Neon Frankfurt | 11 to 28 ms | Azure table: Germany West Central to West Europe 11, France Central 12, Italy North 14, Spain Central 26, North Europe 26, Sweden Central 28 |
| Modal in the EU to Neon London | 11 to 13 ms from West Europe or North Europe | Azure table, UK South |
| The Mac in Europe to Modal's Virginia entry | about 110 ms | Measured, production latency result |
| Cloudflare Amsterdam to Modal's Dublin entry | about 17 ms | Azure table, West Europe to North Europe |
| Browser to the Cloudflare Worker alone | 65 to 83 ms to first byte | Measured, production latency result |

## How the per-call figure is computed

Time per warm signed-in call is the trip to the container plus about 15 database round trips. The 15 is the code estimate after OPS-030 from the warm API round trips result, not a measurement.

- The trip through Virginia to a container beside Neon was measured at 0.14 to 0.20 s for a warm `/api/health` when the Worker reused its connection to Modal. The 0.34 s median for a call with no database was taken while containers sat in `eu-west` and `us-west`, so it is today's trip, not the US pin's.
- The trip through Dublin is not measured. Computed as the Worker's 65 to 83 ms, plus 17 ms to Dublin, plus 0 to 35 ms from Dublin to a container elsewhere in the EU, it is about 0.08 to 0.14 s on a reused connection.
- When the Worker opens a new connection to Modal, three more round trips to the entry are added, which is 0.33 s for Virginia and 0.05 s for Dublin. The production latency result saw about half of the calls in that slow group, at 0.45 to 0.6 s.
- About 9 round trips are left once the pool ping is dropped, which is 15 minus 3 for each of two transactions.

Monthly cost uses the measured $0.145 of `parfocal-api` compute from 1 to 17 November, which is $0.145 times 30 over 17, so $0.26 a month. A modest production load is assumed as 5 people working 8 hours on 22 weekdays with two web containers warm for those 176 hours. One container hour at 0.125 core and 0.5 GiB is $0.0099, so 352 container hours cost $3.48 at base price. Neon at 0.25 CU for 176 hours uses 44 of the 100 free CU-hours.

## Options

| | Stay and cut code | US pin | EU move | EU machine |
|---|---|---|---|---|
| What changes | Nothing in the cloud. Drop the pool ping, about 9 round trips left | `region="us-east"` on the web function | Web function pinned to `eu` and entering at Dublin, new Neon project in Frankfurt | One always-on Hetzner server in Germany with the API and Postgres |
| Database round trip | 60 to 89 ms | 1 to 9 ms | 11 to 28 ms | none over a network, same machine |
| Warm signed-in call, reused connection | 0.34 s plus 9 times 60 to 89 ms, so 0.9 to 1.1 s. Today with 15 it is 1.2 to 1.7 s | 0.14 to 0.20 s plus 0.02 to 0.14 s, so 0.16 to 0.34 s. With 9 round trips 0.15 to 0.28 s | 0.08 to 0.14 s plus 0.17 to 0.42 s, so 0.25 to 0.56 s. With 9 round trips 0.18 to 0.39 s | about 0.1 s, computed from the Worker's time plus 11 ms to Frankfurt |
| Warm signed-in call, new connection | 0.33 s more | 0.49 to 0.67 s. With 9 round trips 0.48 to 0.61 s | 0.30 to 0.61 s. With 9 round trips 0.23 to 0.44 s | about the same |
| Modal web cost today | $0.26 | $0.45 at 1.75 times | $0.29 at 1.15 times, or $0.45 for narrow `eu-west` | $0 |
| Modal web cost at modest load | $3.48 | $6.09 | $4.00, or $6.09 narrow | $0 |
| Other cost | $0 | $0 | $0, a second Free Neon project | from €5.49 a month before VAT in cash, outside the Modal credit ([Hetzner](https://www.hetzner.com/cloud/)) |
| Work | One code task | One line and a deploy | Several steps: new project, migrations, reseed, new function name, new `API_ORIGIN` | The most: server setup, backups, patching, deploys |
| GDPR position | Database and API in the US | Database and API in the US | Database and API processing in the EU. Modal logs and secrets stay in the US | Database and API in the EU with an EU company. GPU work still on Modal |

### Stay and cut code

Keep everything where it is and remove round trips. Dropping the pool ping saves 3 round trips in each transaction, which leaves about 9. It costs nothing and helps every other option too, but no amount of it reaches 300 ms while one round trip costs 60 to 89 ms. The risk is in the ping itself, because Neon's compute suspends and a stale connection must still be caught.

### US pin

Pin only the web function to `us-east`, the narrow region beside Neon. The name is confirmed on Modal's region page and it bills at 1.75 times, so $0.19 a month more today. Ingest, events and GPU functions stay unpinned. Every call from Europe still crosses the Atlantic once, so the measured 0.14 to 0.20 s floor stays, a new connection costs 0.33 s, and further code cuts gain almost nothing. A narrow pin has a smaller pool of machines, so cold starts may get slower. That is not measured. All data sits in the US, which rules this out once real slides arrive, and the move would then have to be done anyway with a data migration instead of a reseed.

### EU move

1. Create a second Neon project in Frankfurt on the Free plan, run the migrations and reseed it. TODO: Neon is billed through the Vercel Marketplace, so the project may have to be created there. No dump is needed because [ADR 0390](../adr/0390-app-parfocal-eu-is-a-development-environment.md) (the deployed app is dev) allows a reseed.
2. Deploy the web function under a new name with `region="eu"` and `routing_region="eu-west"`. TODO: check whether the Modal URL behind `API_ORIGIN` in `apps/edge` changes with the new name.
3. Leave `events`, `ingest` and the GPU functions on the default routing, because `modal_app.py` calls them with `.spawn()`, which regional routing forbids.
4. Measure the round trip from the new container to Frankfurt. If broad `eu` lands far away, switch to narrow `eu-west` for $0.15 a month more today (0.6 times $0.26).
5. Ask the owner before deleting the old US Neon project.

Risks: regional routing was a Public Beta in May 2026. The 11 to 28 ms per round trip is a proxy until step 4 measures it. A second Free project has its own 100 CU-hours, so it adds no cost. This option gets faster with every round trip cut, because its floor is about 0.1 s and a new connection costs 0.05 s instead of 0.33 s. The API also sits nearer Zitadel `eu1` and the R2 bucket.

### EU machine

One small server in Germany runs the API and Postgres together. It is the fastest and puts the data with an EU company, but it breaks the rule that nothing runs all the time, costs cash beyond the Modal credit, and makes backups, patches and uptime the owner's job. GPU work would still run on Modal. Listed for completeness.

## Recommendation

For now, take the EU move in one step. It costs $0.04 a month more than today and less than the US pin, and it is cheap only while the database can be reseeded. On speed the two are close and the order is not settled. The US pin is ahead when the Worker reuses its connection, the EU move is ahead when it opens a new one, and the EU figure rests on a round trip nobody has measured. Both miss 300 ms on a new connection at 15 round trips. If the owner wants the slow calls fixed today with no setup, the US pin is a one-line stopgap that is undone by deleting the line. Decision 140 in `decisions.md` recommends the US pin first. This result changes that advice because Modal's entry point can now be moved to Dublin and because the EU pin is the cheaper multiplier.

When real data arrives, as part of OPS-020 (pin storage, database and Modal functions per region):

- Pin every Modal function to `eu`, GPU included, which multiplies the whole Modal bill by 1.15. A T4 hour goes from $0.59 to $0.68. The $20 production Modal budget then buys what $17.39 buys today.
- Create a new R2 bucket with the `eu` jurisdiction and copy the slides, because the hint on the current bucket is no guarantee.
- Move Neon to the Launch plan for 7 days of restore history. At the modest load above, 44 CU-hours cost $4.66 a month plus $0.35 per GB, which is cash outside the Modal credit and needs the owner's yes.
- Keep patient data out of Modal logs, secrets, images and spawned payloads and keep replies under 2 MiB, because Modal stores those in the US even when pinned.
- Sign the data processing addenda of Modal, Neon and Cloudflare. TODO: read them, they were not read for this result.

## Not covered

- No latency in this file was measured today. The EU figures are proxies from Azure's table until the first EU container is timed.
- Which GPUs Modal has in `eu`, which [ADR 0147](../adr/0147-cloud-provider-regions-and-pilot-cost.md) (cloud provider, regions and pilot cost) also left open.
- Whether a pin changes cold start time.
- Neon's and Modal's sub-processor lists and the legal review of US storage of logs.

## The other deployed parts, checked on 2026-11-17

Added by OPS-031 (move the API and database to the EU) at the owner's request to check every other part for location, price and speed. Facts were read from the services and from vendor pages on that day. Nothing here was moved yet.

| Part | Where it is today | EU option | Price | Speed | Taken |
|---|---|---|---|---|---|
| R2 bucket `parfocal-dev`, the deployed app's slides | Location hint `EEUR`, 657 objects, 28.9 GB, read with `wrangler r2 bucket info` | A new bucket in the `eu` jurisdiction, objects copied, the app pointed at it. The jurisdiction cannot be set on an existing bucket | Cloudflare's [R2 pricing](https://developers.cloudflare.com/r2/pricing/) lists one price table with no jurisdiction surcharge, $0.015 per GB-month. While both buckets exist the copy adds 28.9 GB, about $0.43 a month. The 657 writes fit the free million | No change expected, the hint already keeps it in Europe. Not measured | No, it costs money while both exist and needs code in the Worker binding, the S3 endpoint `<account>.eu.r2.cloudflarestorage.com`, OpenTofu and bootstrap. Backlog task OPS-032 (slides in an EU jurisdiction bucket) |
| Durable Objects in `apps/edge` | No jurisdiction, so each object lives near its first caller | `env.NAMESPACE.jurisdiction("eu")` keeps an object's compute and storage in the EU ([data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)). Ids from the old namespace do not carry over | Free | No change for users in Europe | No, a code change with its own tests, part of OPS-020 |
| Cloudflare Worker placement | Runs in the data center nearest the user | Smart Placement or a placement hint near Modal | Free | Cloudflare's own guidance is that placement helps only with several round trips to the backend. The Worker makes one call to Modal per request, and with the Dublin entry the backend is already near European users | No |
| Zitadel Cloud | Instance `parfocal-iqcyh5.eu1.zitadel.cloud`, region `eu1` | Already in the EU | Free plan | Not measured | Nothing to do |
| Resend | Domain `mail.parfocal.eu` verified in `eu-west-1` (Ireland), read with the Resend MCP | Already in the EU | Free plan | Not measured | Nothing to do |
| Sentry and PostHog | No accounts yet ([platform.md](../knowledge/platform.md)). `apps/web` already allows `eu.posthog.com` | Pick the EU host when each account is made. TODO: confirm on each vendor's page that the region is fixed at sign-up and the free plan is the same in the EU, not read for this result | Free plans | Not measured | Nothing to move yet |
| Modal `ingest` and `events` | Unpinned, so containers land anywhere, often in the US | `region="eu"` on both, beside the Frankfurt database. They drain jobs and outbox rows, so they make many database round trips, 84 to 101 ms each from the US against 14 to 16 ms from the EU (measured in [the EU move](2026-11-17-eu-move.md)) | 1.15 times their estimated $0.35 and $0.10 a month, so about $0.07 a month more | Every job's queries get about six times faster | No, it raises spend. Asked in decision 140 |
| Modal GPU pools | Unpinned | `region="eu"` per pool | 1.15 times the GPU bill, a T4 hour from $0.59 to $0.68. Which GPUs `eu` offers is not known | A GPU run reads tiles from R2 and writes a few rows, so the database matters little | No, part of OPS-020 when real data arrives |

## Step 4 of the EU move: the web function moves from broad `eu` to narrow `eu-west`

Added by OPS-030 (a warm API call answers in under 300 ms) on 2026-11-17, after the cutover.

- Finding: the request log fields cloud and region show the deployed `web-eu` function runs on AWS in eu-north (Stockholm), while Neon is in Frankfurt (`aws-eu-central-1`). The broad pin `eu` lets Modal choose any EU region, and the file's own proxy figure for Sweden is 28 ms a round trip against 11 to 14 ms for Germany West Central and France Central. A warm `/api/me` then spent about 245 ms of database time for 5 queries in 2 transactions and answered in a median of 417 ms end to end, against 125 ms two hours earlier when the container was probably nearer.
- Modal's region page lists no Frankfurt or Germany name. The EU names are `eu` (broad, 1.15 times) and `eu-west`, `eu-north` and `eu-south` (narrow, 1.75 times). Modal says to ask sales for finer regions.
- Chosen: `region="eu-west"` on the web function only. The probe in [the EU move](2026-11-17-eu-move.md) put a container in Modal region `eu-west` at 13.7 to 15.9 ms to the Frankfurt pooler, which is the plan's own step 4 fallback. `routing_region` stays `eu-west` and the function keeps its name, because only `routing_region` is fixed at first deployment. `ingest` and `events` stay on broad `eu`, since the docs do not say they land badly and they are not on the request path.
- Cost from this file's numbers: 1.75 times $0.26 is $0.45 a month today, which is $0.16 more than the broad pin, and $6.09 at modest load, which is $2.09 more than $4.00. Both fit the $30 a month.
- Not yet measured: that `eu-west` containers stay in a region near Frankfurt and the warm medians after the deploy. The lead checks the log fields cloud and region and the medians of `/api/me`, `/api/projects` and `/api/me/home`. If `eu-west` also lands far away, the next try is `eu-south`, which the probe also reached in 14 to 16 ms.

## Step 4 follow-up: Modal cannot pin Azure, so `eu-west` stays and the cloud is not chosen

Added by OPS-030 (a warm API call answers in under 300 ms) on 2026-11-17, after v0.17.4.

- Measured on the deployed app right after v0.17.4, from the request log fields cloud, region and container: two warm containers, both in region eu-west. The Azure one spent about 83 ms of database time on `/api/me` (5 queries, 2 transactions). The AWS one spent about 243 ms on the same call, no better than the earlier eu-north container. The owner's browser medians of ten warm calls were 248 ms for `/api/me`, 294 ms for `/api/projects` and 820 ms for `/api/me/home`.
- Can the web function pin a cloud? The `cloud` parameter of `app.function` exists in the installed Modal SDK (1.6.3), and its docstring reads "Possible values are aws, gcp, oci, auto". Azure is not a value, so the fast container cannot be requested. Modal's [region selection page](https://modal.com/docs/guide/region-selection) does not mention `cloud`, per-cloud price multipliers, minimum or maximum containers, or snapshots, so none of those effects is documented. Nothing was deployed to test them.
- Pinning `cloud="aws"` would lock in the slow 243 ms container, so it is rejected. Pinning `cloud="gcp"` with `eu-west` is untried. It may land in Belgium, about 8 to 10 ms from Frankfurt, but nothing here measures it, whether Modal offers `eu-west` on GCP is unknown, and the web function's `enable_memory_snapshot` setting has not been checked against it. A pin also needs a deploy to see the result, and a wrong pin leaves no warm container to fall back on.
- Cost: no price multiplier is documented for a cloud pin, so the monthly figure stays the one above, $0.45 a month today and $6.09 at modest load for `eu-west`. Nothing changed, so the spend is unchanged.
- Next options, in order. First, ask Modal (support@modal.com or Slack) whether Azure West Europe can be requested for a function or whether the Azure containers were luck of the scheduler. Second, try `cloud="gcp"` with `region="eu-west"` as one deploy and read the log fields, rolled back by removing the line. Third, cut `/api/me` and `/api/me/home` queries further, since a 243 ms container still shows the cost is mostly round trips. Fourth, `eu-south` as the plan's fallback.
