# Result: TLS scan of the live hosts

- Date: 2026-11-16
- Backlog: SEC-002 (encryption in transit and at rest)
- Kind: baseline
- Commit: 820fdbfb, the zone as applied before this task's HSTS setting
- Environment: Qualys SSL Labs public API v3, run from the owner's Mac
- Data: none, the scan reads only the public TLS handshake and response headers

## Question

Does every live `parfocal.eu` host score at least A in a TLS scan, with TLS 1.2 as the oldest protocol, as SEC-002 asks?

## Method

For each host, `GET https://api.ssllabs.com/api/v3/analyze?host=HOST&startNew=on&all=done`, then the same URL without `startNew` every 20 seconds until the status is `READY` or `ERROR`. The hosts are the apex, the Worker custom domains from `apps/edge/wrangler.jsonc` and the zone's other names. `mail.parfocal.eu` has only mail records and no web endpoint. OpenTofu declares no other DNS records.

## Results

| Host | Endpoints | Grade | Protocols | HSTS | Certificate |
| --- | --- | --- | --- | --- | --- |
| `app.parfocal.eu` | 4 (2 IPv4, 2 IPv6) | A+ on all | TLS 1.2, TLS 1.3 | `max-age=31536000; includeSubDomains`, sent by the edge Worker | RSA 2048, Google Trust Services WR1 |
| `parfocal.eu` | 4 (2 IPv4, 2 IPv6) | A on all | TLS 1.2, TLS 1.3 | absent | RSA 2048, Google Trust Services WR1 |
| `staging.parfocal.eu` | none | not scanned | | | the name does not resolve |

SSL Labs reported no warnings on any endpoint and forward secrecy with every browser it simulates.

## Interpretation

Both live hosts meet the A bar and refuse TLS 1.0 and 1.1, so the zone minimum of TLS 1.2 is applied. The apex misses A+ only for lack of HSTS, because the Worker that sends it serves `app.parfocal.eu` alone. The zone HSTS setting added in this task covers the apex once it is applied, which should lift it to A+ (an expectation, not yet measured). Staging is not live, since ADR 0331 (no staging environment) dropped it.

## Follow-ups

- Apply the global root to turn on zone HSTS, then scan the apex again. The plan adds `cloudflare_zone_setting.hsts` and the pending `http3` setting, with nothing changed or destroyed.
- Decision 117 in `docs/decisions.md` asks about HSTS preload.
