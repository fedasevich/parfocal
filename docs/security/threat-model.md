# Threat model

A STRIDE threat model for the five parts of Parfocal that take untrusted input or cross a trust boundary: upload, tile access, guest links, AI jobs and realtime. It is the output of SEC-016 (threat model) and was written on 2026-10-18 against the architecture of [ADR 0003](../adr/0003-pilot-platform-architecture.md), [ADR 0050](../adr/0050-deploy-pipeline-and-previews.md) and the backlog as it stood that day. Most of these parts are still planned, so the model describes the design they must meet, not code that was tested.

## How to read it

- STRIDE letters: S spoofing, T tampering, R repudiation, I information disclosure, D denial of service, E elevation of privilege.
- The rating is a judgement of likelihood and impact for a pilot with real patient data, not a measurement. High means a single flaw could expose another tenant's data or patient data, or run arbitrary code. Medium means harm within one tenant, a cost, or an outage. Low means a nuisance with a cheap fix.
- Every High threat names the backlog task that mitigates it. A task marked "new" was added to the backlog with this model.
- "Done" means the mitigation exists in code today. Everything else is planned.

## Trust boundaries

| Boundary | What crosses it | Who is trusted on the far side |
|---|---|---|
| Browser to edge Worker | Cookies, API calls, tile requests, WebSocket frames | Nobody. Every request is checked |
| Edge Worker to FastAPI | Forwarded API calls with the session cookie | FastAPI trusts the Worker's routing, not its claims about the user |
| Edge Worker to R2 | Byte ranges for one object key | R2 holds data for every tenant in one bucket per environment |
| FastAPI to Postgres | Queries under a per-transaction tenant scope and row-level security | Postgres enforces tenant isolation ([ADR 0018](../adr/0018-postgres-sqlalchemy-rls.md)) |
| FastAPI to Modal workers | Job rows and capability tokens | Workers trust only tokens signed by the API (ADR 0003 rule 2) |
| Workers to file parsers | Slide and result files uploaded by users | Nobody. Files are hostile until checked |
| Parfocal to a lab's model endpoint or a connected source | Tiles out, results in, credentials | A server outside Parfocal that an admin chose |
| Durable Object rooms to browsers | Ephemeral events | Rooms hold no data of record (ADR 0003 rule 3) |

Controls that every part relies on, and that are done:

- Tenant isolation by row-level security in every transaction, with a suite that seeds two tenants and checks every route and table (IAM-004, `test_tenant_isolation.py`).
- Project roles that narrow the workspace grant, with a reviewer seeing only their task slides (IAM-022, PROJ-003).
- The session is a random id in a `__Host-` cookie, HttpOnly, Secure and SameSite=Strict, stored as a hash, with an idle lock ([ADR 0025](../adr/0025-zitadel-bff-login.md), [ADR 0031](../adr/0031-idle-lock-from-explicit-activity.md)).
- An append-only, hash-chained audit log with people named by erasable pseudonyms (SEC-003, [ADR 0027](../adr/0027-audit-log-hash-chain-in-postgres.md)).
- Direct identifiers sealed with per-tenant data keys and searched by blind index (SEC-004, [ADR 0033](../adr/0033-envelope-encryption-with-tenant-data-keys.md)).

## Cross-cutting threats

| ID | STRIDE | Threat | Rating | Mitigation | Task |
|---|---|---|---|---|---|
| X1 | T, E | Cross-site request forgery on cookie-authenticated writes. SameSite=Strict stops other sites, but any page on a sibling subdomain of the app's registrable domain is same-site, so a compromised or user-content subdomain could post to the API with the session cookie | High | Refuse unsafe methods whose `Origin` (or `Sec-Fetch-Site`) is not the app origin | SEC-025 (new) |
| X2 | I, E | Cross-site scripting in the SPA steals actions, not the cookie, which is HttpOnly | High | React escaping, no `dangerouslySetInnerHTML` on user text, strict CSP with nonces | SEC-011 (security headers and CSP) |
| X3 | D | One user or tenant floods the API, uploads or jobs | Medium | Per user and per tenant limits with 429 | SEC-012 (rate limiting) |
| X4 | I | Patient data in logs, traces or error reports | High | One scrubbing rule set, ids instead of names in URLs, a scan of an E2E run's telemetry | SEC-010 (PHI-safe telemetry), [ADR 0040](../adr/0040-observability-and-phi-scrubbing.md) |
| X5 | E | A leaked deploy or storage secret | High | Secret scanner in CI (done), runtime secrets from the store, rotation tested | SEC-013 (secrets management), STACK-037 (key management) |
| X6 | T, E | A vulnerable native library (OpenSlide, libtiff, OpenJPEG, libjpeg, OpenCV) or dependency | High | Advisory triage and update cadence | SEC-015 (vulnerability management) |

## Upload

Slides arrive as presigned multipart uploads straight to R2, then the ingest workflow identifies, checks and reads them (INGEST-001 to INGEST-006, [ADR 0081](../adr/0081-uploads-are-checked-by-structure.md)). Result files (GeoJSON, CSV, masks, Parfocal JSON) are parsed by the ingest worker ([ADR 0070](../adr/0070-result-file-parsers.md)). An upload can also come from a link that the server downloads (INGEST-025).

| ID | STRIDE | Threat | Rating | Mitigation | Task |
|---|---|---|---|---|---|
| U1 | S, E | Someone completes, reads or overwrites another tenant's upload | High | Uploads land in a tenant-scoped quarantine prefix, part URLs are short-lived and bound to one upload, and tenant B cannot complete tenant A's upload | INGEST-001 (upload API) |
| U2 | T, E | A crafted slide or mask exploits a parser and runs code in the worker | High | Structure checks before any reader (done), and parsing in an isolated worker with no network egress except the job's own storage keys, no secrets beyond a job token, a memory and time limit and a non-root user | INGEST-005 (structure checks, done), SEC-026 (new) |
| U3 | D | A decompression bomb, a huge pyramid level or a JSON file with millions of objects exhausts memory | Medium | Zip CRC and size checks (done), level dimension limits (done), a size limit per result file and streaming parsers | INGEST-005, INGEST-006 (done), RSET-005 (import checks and fixes) |
| U4 | I | Patient names on the slide label or macro image, or in file metadata, reach a de-identified project | High | Label and macro handling, and de-identified projects that refuse identifying columns | SEC-009 (label and macro handling), SEC-008 (de-identified projects) |
| U5 | S, I | Import from a link fetches an internal address (server-side request forgery), such as cloud metadata or the database | High | Refuse private, loopback and link-local addresses, also after redirects and DNS changes, and cap the size | INGEST-025 (import from a link) |
| U6 | R | An uploader denies having uploaded a file | Low | Upload and publish audit entries: `upload.completed`, `upload.aborted` and `upload.expired` from the upload API, and `slide.published` and `upload.refused` from the ingest job | INGEST-001, INGEST-017 (publish step) |
| U7 | T | A file is swapped in storage after its checks passed | Medium | Checks and reads use the stored checksum, and the quarantine prefix is not writable after completion. The ingest job keeps the SHA-256 of the file it checked in `slides.sha256`, copies that object out of quarantine under a key no client can sign, and deletes the quarantine copy. TODO: compare the published copy with `slides.sha256` before serving tiles | INGEST-001, INGEST-017 (publish step) |

## Tile access

The viewer reads byte ranges of the originals through the edge Worker, which checks a capability token signed by the API and reads R2 through its binding (TILES-001 to TILES-007, STACK-025). A connected source can be read in place (REMOTE-001).

| ID | STRIDE | Threat | Rating | Mitigation | Task |
|---|---|---|---|---|---|
| T1 | S, E | A forged, expired or other tenant's token reads a slide | High | Tokens signed by the API, scoped to tenant and slide, short-lived, verified without a database call, and the R2 key derived from the token, never from the URL alone | TILES-001 (signed access to slide bytes), STACK-025 (object storage) |
| T2 | I | A token leaks through a URL, the `Referer` header or a log and is replayed | Medium | Tokens in a header or same-origin cookie rather than the query string where the readers allow it, `Referrer-Policy`, and tile logs that carry ids only | TILES-003 (same-origin data path), SEC-011, TILES-007 (tile access logging) |
| T3 | E | A person removed from a project keeps reading tiles until the token expires | Medium | A token lifetime of minutes, refreshed through the API, which rechecks the grant | TILES-001 |
| T4 | D | Tile requests run up Worker and R2 cost | Medium | Per user limits at the edge, cache keyed per object and byte range | SEC-012, TILES-002 (CDN) |
| T5 | S, I | A connected source's credentials leak, or its URL points at an internal address | High | Source credentials sealed with the tenant data key, the same address rules as U5, and reads only through the gateway | REMOTE-001 (read in place) |
| T6 | R | Who opened which slide cannot be shown | Medium | One audit entry per slide open, not per tile | TILES-007 |

## Guest links

Guest consultant links are an idea since [ADR 0053](../adr/0053-ai-results-review-direction.md), and the guest scope was removed by [ADR 0060](../adr/0060-no-sign-out-permissions-or-guest-scope.md). Nothing is built, so nothing is exposed today. If IAM-010 (guest consultant links) or IAM-019 (sign-in by emailed code) comes back, it must meet these before it ships.

| ID | STRIDE | Threat | Rating | Mitigation | Task |
|---|---|---|---|---|---|
| G1 | S | A forwarded link gives someone else the guest's access | High | The link only invites, and the guest signs in with their own identity or a verified email | IAM-010 |
| G2 | E | A guest reads beyond the shared case or view | High | A restrictive scope checked in the database, not only in code, with an isolation test like the tenant suite | IAM-010 |
| G3 | E | A revoked or expired link keeps working on an open session | Medium | Revocation ends guest sessions within one minute | IAM-010 |
| G4 | R | A guest's actions cannot be told from a member's | Low | Audit entries name the guest grant | IAM-010 |

## AI jobs

A researcher runs a Parfocal model on Modal or a lab's own model through an HTTP endpoint that an admin connects (JOBS-001, JOBS-005, AIP-006 to AIP-009). Workers write result chunks to storage and rows to the job tables.

| ID | STRIDE | Threat | Rating | Mitigation | Task |
|---|---|---|---|---|---|
| J1 | S, I | A lab model endpoint points at an internal address, which turns the job runner into a request forgery tool | High | The same address rules as U5 when the endpoint is saved and on every call, and no redirects followed | JOBS-005 (connect a lab model) |
| J2 | I | Endpoint credentials leak from the database or logs | High | Credentials sealed with the tenant data key, shown masked, never logged | JOBS-005 |
| J3 | I | Tiles of a clinical project are sent to an outside server that the project's owners did not expect | Medium | Only admins connect endpoints, each endpoint lists the projects that may use it, and each run is audited with the endpoint | JOBS-005, JOBS-001 (model run API) |
| J4 | T, D | A model answer is malformed, huge or claims objects outside the slide | Medium | The Parfocal JSON validator (done), a size limit and coordinates clipped to the slide | RSET-002 (done), JOBS-005 |
| J5 | T | Model weights or images are swapped | Medium | Weights stored with their checksum and the version recorded in the result set | AIP-001 (model artifact storage), AIP-002 (model registry) |
| J6 | E | A worker reads or writes another tenant's data | High | Job rows carry the tenant, workers act only through a job token scoped to one tenant and slide, and nothing batches across tenants | AIP-008 (job model and API), AINUC-001 (detector runner) |
| J7 | D | Many runs exhaust GPU budget | Medium | Per tenant run limits and the interactive priority gate | SEC-012, AIP-007 (priority gate) |

## Realtime

Durable Object rooms per slide, per task and per user carry ephemeral events, and the API posts events to them (COLLAB-001, STACK-024).

| ID | STRIDE | Threat | Rating | Mitigation | Task |
|---|---|---|---|---|---|
| R1 | S, E | A client joins another tenant's room | High | Room tokens signed by the API and scoped to tenant and room, with a test that a user never receives another tenant's events | COLLAB-001 (realtime infrastructure) |
| R2 | E | A socket stays open after its owner leaves the project or the workspace | Medium | Room tokens expire within minutes and a reconnect rechecks the grant, and a removal closes the person's sockets | COLLAB-001 |
| R3 | I | An event carries patient data to everyone in a room | Medium | Events carry ids and kinds only, and clients refetch through the API | COLLAB-001 |
| R4 | T | A client sends forged events to a room | Medium | Rooms accept events only from the API, and client frames are limited to presence | COLLAB-001 |
| R5 | D | Floods of connections or frames | Low | Per user connection limits and frame size limits | SEC-012 |

## Changes made with this model

- New task SEC-025 (Origin check on cookie writes) for X1.
- New task SEC-026 (isolated parsing of uploaded files) for U2.
- JOBS-005 (connect a lab model) now names the address rules, sealed credentials and the project list for J1 to J3.
- COLLAB-001 (realtime infrastructure) now names token expiry and closing sockets on removal for R2.
- REMOTE-001 (read in place) now names sealed credentials and the address rules for T5.

TODO: revisit this model when STACK-024 (realtime transport), STACK-025 (object storage) and STACK-039 (resumable upload) are decided, and before SEC-022 (external penetration test).
