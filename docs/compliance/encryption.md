# Encryption in transit and at rest

SEC-002 (encryption in transit and at rest). This page lists every place Parfocal data travels or rests and what encrypts it. The scan behind the transit claims is [the TLS scan result](../results/2026-11-16-tls-scan-of-the-live-hosts.md).

## In transit

| Path | Protection | Enforced by |
| --- | --- | --- |
| Browser to `app.parfocal.eu` and `staging.parfocal.eu` | TLS 1.2 or 1.3 at the Cloudflare edge, HTTP redirected to HTTPS, HSTS for a year with subdomains | Zone settings `min_tls_version`, `tls_1_3`, `always_use_https` and `ssl = strict` plus the zone HSTS setting in `infra/tofu/global/zone.tf`, checked by `policy.sh static` in the infra workflow. The edge Worker also sends HSTS itself (`apps/edge/src/security-headers.ts`, tested in `security-headers.test.ts`) |
| Edge Worker to the API on Modal | HTTPS to the `modal.run` origin | The Worker fetches `API_ORIGIN`, which the deploy sets to the Modal HTTPS URL |
| API and workers to Neon Postgres | TLS with `ssl=require` | `require_tls_database` in `parfocal_common.transport`, called by the API and provisioning settings in staging and prod. The deploy builds the URL from Neon's own URI, which carries `sslmode=require` |
| API and workers to R2 | HTTPS to `<account>.r2.cloudflarestorage.com` | `StorageSettings` refuses a plain HTTP `STORAGE_ENDPOINT` in staging and prod |
| API to Zitadel and to the edge realtime endpoint | HTTPS | `ApiSettings` refuses plain HTTP `ZITADEL_ISSUER`, `PUBLIC_ORIGIN` and `REALTIME_INTERNAL_URL` in staging and prod |

Dev, test and preview keep plain HTTP to local MinIO and Postgres, because both run on the same machine.

## At rest

| Store | Holds | Encryption |
| --- | --- | --- |
| R2 buckets `parfocal-dev`, `parfocal-prod` | Slides, derived tiles, uploads | AES-256-GCM on every object and its metadata, always on, keys held by Cloudflare ([R2 data security](https://developers.cloudflare.com/r2/reference/data-security/)) |
| R2 bucket `parfocal-tfstate` | OpenTofu state | R2 encryption as above, plus client-side state and plan encryption that every root must enforce (`static.rego`) |
| Neon Postgres, including its point-in-time history and branches used by the restore check | Tenants, annotations, decisions, audit log | XTS-AES-256 on the NVMe volumes ([Neon security overview](https://neon.com/docs/security/security-overview)). Patient identifiers are also sealed per tenant key by SEC-004 (field encryption) |
| Durable Objects for realtime rooms | Room presence only | AES-256 with LUKS ([Durable Objects data security](https://developers.cloudflare.com/durable-objects/reference/data-security/)) |
| Modal containers | Ingest work files while a job runs | No Modal volume is used, files live only in the container's temporary disk. TODO: cite Modal's statement on disk encryption |

None of these stores has a setting that turns encryption off, so there is nothing for OpenTofu to declare.
