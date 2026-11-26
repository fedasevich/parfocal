# 0446. R2 never uses Infrequent Access

- Date: 2026-11-26
- Status: Accepted
- Deciders: owner
- Backlog: OPS-009 (storage lifecycle and cost controls). Amends [ADR 0341](0341-old-tenant-objects-tier-to-infrequent-access-and-budgets-live-in-a-cost-report.md) (old tenant objects tier to Infrequent Access and budgets live in a cost report), whose cost report and budgets stay

## Context

ADR 0341 moved objects under `t/` to R2 Infrequent Access after 90 days to save storage. Infrequent Access has no free tier, and Cloudflare rounds every billing line up to the next unit. One Class A operation in a month bills as a million at $9.00, one Class B operation as a million at $0.90, and any stored byte as 1 GB-month for at least 30 days. On 2026-11-25 the OPS-009 drill moved one 48-byte object and the November bill grew by $9.01. The slide buckets hold tens of GB, where tiering saves cents a month, so every month with one move would lose about $9 of a $30 monthly budget. The owner wrote on 2026-11-26 that $9 is too much and that Infrequent Access must not be used again.

## Options considered

1. Keep the 90-day rule and accept $9 in each month that moves an object.
2. Never use Infrequent Access. Every bucket stays Standard and no lifecycle rule changes a storage class.

## Decision

Option 2.

- The environment module has no `tier-old-tenant-objects` rule and no `tier_after_days` variable. It was removed from `parfocal-dev-eu` and `parfocal-prod` by `tofu apply` on 2026-11-26 (1 changed, 0 destroyed in each root).
- Conftest refuses any lifecycle rule with a storage class transition and any `cloudflare_r2_bucket` whose `storage_class` is not Standard.
- Code never sends `x-amz-storage-class` or a Workers `storageClass` option, and buckets made outside OpenTofu, drills included, stay Standard.

## Consequences

- Storage stays at $0.015 per GB-month past the free 10 GB, about $0.45 a month for the current 40 GB.
- A drill or test that needs another storage class is a spend question for the owner first.
- The cost report still prices R2 as Standard, which is now exact.
