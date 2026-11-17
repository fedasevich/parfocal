# 0378. Saved import sources keep their credentials on the server

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: INGEST-026 (saved import sources)

## Context

INGEST-026 (saved import sources) lets a researcher with admin rights save a source once, with a name, a type, an address and credentials, and lets anyone who may upload pick it when importing. In v1 the types are HTTPS and object storage. The credentials must never reach the browser, the logs or the quarantine prefix in storage, and every fetch must still go through the address check of [ADR 0245](0245-link-imports-fetched-by-the-worker-behind-an-address-check.md) (link imports fetched by the worker behind an address check). The listing runs in the API and the download runs in the ingest worker, so the worker has to be able to authenticate too.

## Decision

1. A new tenant table `import_sources` (migration 0127) holds the name, type, address, storage region and header name. The credential is one JSON value, sealed with the tenant data key like lab model secrets ([ADR 0263](0263-lab-model-endpoints-with-sealed-credentials.md), lab model endpoints with sealed credentials). Responses carry only `has_credential`, and audit details only the name, type and host.
2. Saving, changing and deleting a source need `integrations` with write, which only admin rights give. Listing the saved sources needs `integrations`, which researchers hold as view only and reviewers lack. Listing and importing from a source need `upload-slides`, as for a link.
3. `listSourceFiles` and `importFromLink` take `source_id` in place of `address`. The browser never sends or receives anything but the ID and the display address.
4. An object storage source is resolved in the API. It signs a ListObjectsV2 request for the saved bucket and prefix with one folder level, lists it through `open_link`, and signs each object GET for `link_fetch_seconds` plus 6 hours. The signed URL goes into the quarantine note exactly like a presigned link a user pastes, so the worker is unchanged for this type and the secret key never leaves the API.
5. An HTTPS source sends its credential as a header. `open_link` takes extra headers and sends them only while the URL keeps the scheme, host and port of the first request, so a redirect to another origin never receives them. The quarantine note holds the address and the source ID, never the value. The ingest worker reads `MASTER_KEYS`, which its Modal function already mounts, opens the sealed value and sends the header.

## Alternatives

- Resolving the HTTPS header in the API and writing it into the quarantine note would leave the worker unchanged, but it would copy a long-lived secret into storage for the length of every fetch.
- Signing storage requests in the worker would keep both types in one shape, but the API needs the signed listing anyway, and a short-lived signature in storage is what ADR 0245 already accepts for pasted links.
- Passing the credential through `ObjectStore` would reuse its signing client, but that client skips the address check that ADR 0245 makes the only way out.

## Consequences

- Deleting a source while a fetch from it waits fails that HTTPS fetch with `link-status`. A storage fetch still finishes on its signed URL.
- The access key ID appears in the signed URLs in the quarantine note, as it does for any presigned link.
- There is no admin screen for sources yet. ADMIN-006 (storage, sources, API and webhooks) builds it on these routes. Until then sources are saved through the API.
- DICOMweb, SFTP and scanner shares wait for their own epics.
