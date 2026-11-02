# 0147. The pilot stays on Cloudflare, Modal and Neon with no hyperscaler, and costs about $140 a month before GPU work and slide storage growth

- Date: 2026-11-02
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: STACK-029 (cloud provider, regions and GPU availability). Amends [ADR 0003](0003-pilot-platform-architecture.md) (pilot platform architecture), whose "Known costs" left the monthly estimate as TODO. Touches OPS-009 (storage lifecycle and cost controls), AIP-007 (priority gate) and SEC-005 (data residency)

## Context

The backlog default for STACK-029 compared AWS, Google Cloud, Azure and an EU sovereign cloud on five criteria: an EU region with L4, L40S, A100 or H100 GPUs, a HIPAA BAA, ISO 27001 certified regions, managed Postgres with PostGIS, and managed Kubernetes. [ADR 0003](0003-pilot-platform-architecture.md) already replaced that default with no single cloud: TypeScript on Cloudflare, Python and GPUs on Modal, Postgres on Neon, and no region pinning while the pilot holds only public slides with fake patients. [ADR 0115](0115-production-access-and-spend-caps.md) (production access and spend caps) added hard caps, so Modal stops at its $30 of monthly credits today.

This record does not redo ADR 0003. It checks that the chosen vendors still meet the EU and GPU criteria when the "first tenant with real PHI" trigger of ADR 0003 fires, keeps the hyperscaler comparison for that day, and gives the monthly estimate the task's "Done when" asks for: three tenants and 5,000 slides a month.

All prices and availability below were read on 2026-11-02 from the pages listed under Sources. Nothing was run, so there is no result file and every workload number is an assumption, marked as such.

## Options considered

| Criterion | Chosen stack (Cloudflare, Modal, Neon) | AWS | Google Cloud | Azure | OVHcloud (EU sovereign) |
|---|---|---|---|---|---|
| EU GPUs | Modal regions `eu` (European Economic Area, broad), `eu-west`, `eu-north` and `eu-south` (narrow). Modal sells T4, L4, A10, L40S, A100, H100, H200 and B200, but which of them run in each EU region was not checked | L4 in the G6 family. EU regions not checked | L4 (G2) in europe-west1, 3 and 4. A100 (A2) in europe-west4. H100 (A3) in europe-west1, 3, 4 and 9. No L40S found | A100 and H100 series exist (NC_A100_v4, NCads_H100_v5). EU regions not checked | L4, L40S and H100 in Gravelines. No A100 found |
| HIPAA BAA | Modal: HIPAA only on Enterprise. Neon: HIPAA self-serve on Scale with a BAA. Cloudflare: not checked | Yes, a standard BAA | Yes | Yes, in the Product Terms | Only in its US datacentres |
| ISO 27001 for EU regions | Not checked for any of the three | Not checked | Not checked | Certified, regions not listed | ISO 27001:2013 stated, regions not listed |
| Postgres with PostGIS | Neon, PostGIS on Neon not checked. The pooler spike of 2026-10-08 used local PostGIS 3.6 only | Not checked | Cloud SQL or AlloyDB, PostGIS not checked | Azure Database for PostgreSQL, PostGIS not checked | Managed PostgreSQL, PostGIS not checked |
| Managed Kubernetes | Not needed, ADR 0003 removed Kubernetes | EKS | GKE | AKS | Managed Kubernetes Service |
| Fixed monthly fee for the pilot | $5 (Workers Paid) | Not priced | Not priced | Not priced | Not priced |

1. Stay on the ADR 0003 stack. Every service scales to zero or bills per second, Modal has EU regions and sells every GPU on the list, and which GPUs each EU region holds is a TODO for the PHI trigger. The cost of moving to PHI is plan upgrades (Modal Enterprise for HIPAA, Neon Scale), which risk R10 already names.
2. Move to one hyperscaler. One BAA and one compliance report cover everything, but it brings back the Kubernetes or VM operations that ADR 0003 rejected for a one-person team, and a GPU node billed by the hour while idle.
3. Move to an EU sovereign cloud such as OVHcloud or Scaleway. Data stays with an EU company, but no HIPAA BAA for EU regions was found and GPU work would again need always-on machines. The Scaleway price page refused the fetch (403), so it was not compared.

## Decision

Option 1. The pilot stays on Cloudflare, Modal and Neon with no region pin, as ADR 0003 says, and the hyperscaler table stays here for the day the PHI trigger fires. On that day the choice is between Modal Enterprise with region `eu` and the hyperscaler with the best BAA and EU GPU fit, and the cells marked "not checked" must be filled first.

### Monthly estimate for the pilot

The workload is three tenants and 5,000 slides a month. Three tenants change almost nothing, because every service bills by use and Zitadel's free plan counts users, not organisations.

Workload assumptions, each a guess until measured:

- A slide is 1 GB. The basis is the 28 public fixtures in `fixtures.json`, whose mean is 0.93 GB and median 0.21 GB. Storage cost scales linearly with this number.
- Each slide is opened twice and each opening reads 2,000 tiles, so 20 million tile requests a month go through the Worker and R2.
- Ingest takes 120 seconds on 2 CPU cores and 4 GiB per slide. TODO: measure it on Modal dev once INGEST-028 (upload protocol check on the R2 dev bucket) runs.
- The API runs one always-on Modal container with 1 core and 1 GiB. STACK-019 (the web framework) may allow scale to zero, which removes most of this line.
- Neon runs 0.25 CU without autosuspend, as [knowledge/platform.md](../knowledge/platform.md) asks for production, and stores 10 GB.
- A model run takes the catalogue's nominal minutes per slide from `model_catalogue.py` (4 for `camelyon-tumor`, 17 for `pathosam-hovernext`). These are the frozen mock's numbers, not measurements, and the GPU they assume is not stated. The estimate prices them on an L4 with 4 cores and 16 GiB beside it.

Base month, with every slide's AI results imported and none run:

| Line | Price used | Month 1 |
|---|---|---|
| Workers Paid | $5 a month, 10 million requests included, then $0.30 per million | $8.00 |
| R2 storage | $0.015 per GB-month past 10 GB, 5,000 GB stored | $74.85 |
| R2 reads | Class B at $0.36 per million past 10 million | $3.60 |
| R2 writes | Class A at $4.50 per million past 1 million. About 120 per slide (16 MiB upload parts and the copy out of quarantine), so 0.6 million | $0 |
| Modal API container | $0.0000131 per core-second and $0.00000222 per GiB-second, 30 days | $39.71 |
| Modal ingest | Same rates, 5,000 slides | $21.05 |
| Modal credits | Starter includes $30 of compute a month | -$30.00 |
| Neon Launch | $0.106 per CU-hour and $0.35 per GB-month | $22.84 |
| Durable Objects | 1 million requests and 400,000 GB-s included in Workers Paid, WebSocket messages counted 20 to 1 | $0 |
| Zitadel Cloud | Free plan below 100 daily active users | $0 |
| Total | | about $140 |

Two lines dwarf the rest, and both depend on choices the owner has not made yet.

| Driver | Month 1 | Month 3 | Month 6 | Month 12 |
|---|---|---|---|---|
| R2 storage if every original is kept | $75 | $225 | $450 | $900 |
| R2 storage if originals are deleted after 90 days | $75 | $225 | $225 | $225 |
| GPU, every slide runs `camelyon-tumor` (333 L4 hours) | $372 | $372 | $372 | $372 |
| GPU, every slide runs `pathosam-hovernext` (1,417 L4 hours) | $1,581 | $1,581 | $1,581 | $1,581 |

So the pilot costs about $140 in its first month with imported results, about $515 by month 6 if every original is kept, and $1,700 or more in any month where every slide runs the heaviest built-in model. The GPU line is the L4 at $0.000222 a second ($0.80 an hour) plus the CPU and memory beside it. Regional pinning to `eu` would multiply every Modal line by 1.15.

## Consequences

- ADR 0003's "Known costs" TODO points here. Risk R8 (vendor lock-in and spend) can be checked against these lines, and OPS-009 sets per-environment budgets from them.
- The Modal hard cap of $30 with a $0 spend limit stops the API container alone within the month, and any GPU work at once. Before the pilot runs, the owner must choose a Modal spend limit. That is a billing change only the owner makes, so it is a question in [decisions.md](../decisions.md).
- How many slides run a built-in model, and how long originals are kept, are product questions. They are in [decisions.md](../decisions.md) too.
- Modal's pricing page now lists region selection on every plan at 1.15 times for a broad region and 1.75 times for a narrow one. [knowledge/platform.md](../knowledge/platform.md) said it needs the Team plan at 1.5 times, and is corrected.
- TODO: measure ingest seconds per slide, tile requests per opening and GPU seconds per model run, then replace the assumptions above. Fill the "not checked" cells before the PHI trigger.

## Sources

All read on 2026-11-02.

- Modal prices, plans and HIPAA: https://modal.com/pricing
- Modal regions and multipliers: https://modal.com/docs/guide/region-selection
- R2 prices: https://developers.cloudflare.com/r2/pricing/
- Workers and Durable Objects prices: https://developers.cloudflare.com/workers/platform/pricing/
- Neon plans, prices and HIPAA: https://neon.com/pricing
- AWS L4 instances: https://aws.amazon.com/ec2/instance-types/g6/
- AWS BAA: https://aws.amazon.com/compliance/hipaa-compliance/
- Google Cloud GPU zones: https://docs.cloud.google.com/compute/docs/gpus/gpu-regions-zones
- Google Cloud BAA and covered services: https://docs.cloud.google.com/docs/security/compliance/hipaa
- Azure GPU series: https://learn.microsoft.com/en-us/azure/virtual-machines/sizes
- Azure BAA: https://learn.microsoft.com/en-us/azure/compliance/offerings/offering-hipaa-us
- Azure ISO 27001: https://learn.microsoft.com/en-us/azure/compliance/offerings/offering-iso-27001
- OVHcloud GPUs and services: https://www.ovhcloud.com/en/public-cloud/prices/
- OVHcloud regions: https://www.ovhcloud.com/en/public-cloud/regions-availability/
- OVHcloud compliance: https://www.ovhcloud.com/en/compliance/
