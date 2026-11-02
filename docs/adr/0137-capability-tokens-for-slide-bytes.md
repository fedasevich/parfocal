# 0137. Slide bytes are read with a ten-minute HMAC capability token that carries the closed byte ranges

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: TILES-001 (signed access to slide bytes). Builds on [ADR 0003](0003-pilot-platform-architecture.md) (pilot platform architecture) and [ADR 0124](0124-labels-and-macros-only-for-whole-project-readers-in-clinical-projects.md) (labels and macros only for whole-project readers). Touches TILES-003 (same-origin data path), SKEL-006 (open the slide in Viv) and STACK-025 (object storage, CDN and signed access)

## Context

ADR 0003 says the API checks access and signs a short-lived token scoped to tenant and slide, and the edge Worker checks only the signature, never the database. Nothing chose the token format, its lifetime, how the viewer renews it, or how the edge keeps the label and macro pages of the original out of reach, which the owner settled on 2026-11-02: ingest records their byte ranges and the edge refuses any range that overlaps them.

## Options considered

### Token format

1. HMAC-SHA256 over a base64url JSON payload, with one secret shared by the API and the Worker. Python's `hmac` and WebCrypto in the Worker, no library, a few hundred bytes per token.
2. An asymmetric JWT (Ed25519 or ES256). The Worker would hold only a public key, but it needs a JWT library or hand-written parsing, verification costs more per tile, and both sides are ours.

### Where the closed ranges live

1. In the token. The API reads them once per token from a small file ingest writes next to the original, so the edge needs no read beyond the tile itself.
2. In a file the edge reads from R2 per slide. Tokens stay small, but every cold isolate pays an extra read, and the edge must decide what a missing file means.
3. In a new `slides` column. Clean, but it needs a migration, and the API would still have to put them in the token.

### Which ranges are closed

1. Every byte of image data outside the main pyramid series, found with `tifffile` through the same `main_series` the level table uses. This covers label, macro, thumbnail, map and probability pages on every TIFF family format without per-format names.
2. Only the series whose size matches an extracted label or macro. Narrower, but it leaks when extraction is skipped, as SEC-008 (de-identified projects) will do.

## Decision

Option 1 for the format, option 1 for where the ranges live and option 1 for which ranges are closed.

| Concern | Rule |
|---|---|
| Token | `base64url(payload).base64url(HMAC-SHA256(key, payload))`, payload `{"a", "d", "e", "n", "o", "s", "t", "v"}`: a viewer hash (SHA-256 of the actor kind and subject, 12 bytes, added by TILES-007), closed ranges as `[start, end)` pairs, expiry in Unix seconds, original size, original file name, slide, tenant and version 1. `apps/edge/test/capability-vector.json` is checked by both sides |
| Key | `tile_token_key` in the API settings and `TILE_TOKEN_KEY` in the Worker, 32 random bytes in base64. Without it the API answers 503 `tile-access-not-configured` |
| Minting | `GET /api/slides/{slide_id}/tile-access` (`getTileAccess`) under `see-slides` and `require_slide_reading`, `Cache-Control: private, no-store`. It returns the token, its expiry, `lifetime_seconds` 600, `base_path` `/tiles/{slide_id}/` and the original's name. A slide with no stored file is 404 `slide-file-not-found` |
| Missing ranges file | A slide without `restricted-ranges.json` gets its whole original closed, so slides published before this change fail closed |
| Edge | `GET` or `HEAD /tiles/{slide_id}/{file}` with `Authorization: Bearer`. The key is `t/{tenant}/s/{slide}/{file}` from the token, never from the URL. 401 `tile-token-missing`, `tile-token-invalid` or `tile-token-expired`, 403 `tile-token-other-slide` when the URL names another slide, 416 for several ranges, 403 `range-restricted` for a range of the original, or no range at all, that overlaps a closed range. Files under the restricted prefix are never reachable |
| Closed ranges | Ingest's derive step writes `t/{tenant}/s/{slide}/restricted-ranges.json`, merged. DICOM files and zip archives are closed whole until a viewer reads them by range |
| Renewal | `TileAccess` in `@parfocal/viewer-engine` renews in the background after half the lifetime, waits for a new token 30 seconds before the end, measured on the browser's clock from when it asked, and on a 401 renews once and asks again |
| Opens and logs | Added by TILES-007 (tile access logging without PHI). `getTileAccess` records `slide.opened` on the slide with empty details, unless the request carries a `Previous-Tile-Token` header holding a token this key signed for the same version, tenant, slide and viewer that expired at most 60 seconds ago. `TileAccess` sends the token it replaces on every renewal, so one viewing session is one audit entry, and only someone who already holds a token from an audited open can skip it. The patient's audit trail lists these entries. The Worker logs one JSON line `{"tenant", "slide"}` per request whose token it accepted, and nothing for refused tokens |

The edge refuses the closed ranges for every reader, the owners included, because ADR 0124 wants every label read audited and only the API route records one.

## Consequences

- A person removed from a project keeps reading for at most ten minutes, as threat model T3 (removed reader keeps reading) allows.
- Rotating the key fails each open viewer's next tile once, after which `TileAccess` renews and retries. A key id for overlapping keys is a later change if rotation becomes routine.
- A multi-plane AVS file shows only its main plane through the edge, because the other planes sit outside the main series, as the level table already assumes.
- The Leica SCN header XML in the first IFD carries the slide barcode, which any token holder can read. Decision 17a (barcodes in file headers) in [decisions.md](../decisions.md) asks what to do.
- Deploying needs a wrangler config with the R2 binding and the secret set in Cloudflare and Modal, which are production writes for the owner.
- TODO: the number 0137 was free on `origin/main` on 2026-11-02. If another branch takes it first, renumber this record.
