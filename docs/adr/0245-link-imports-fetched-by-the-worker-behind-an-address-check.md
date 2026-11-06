# 0245. Link imports are fetched by the worker behind an address check

- Date: 2026-11-06
- Status: Accepted
- Deciders: Yurii Fedas, agent
- Backlog: INGEST-025 (import slides from a link)

## Context

INGEST-025 (import slides from a link) lets a user give an HTTPS, S3 or Azure link instead of files from the computer. The server reads what the link holds, so the link is attacker-chosen input to a server-side request, which is threat U5 (server-side request forgery) in [the threat model](../security/threat-model.md). The fetch of a 20 GB slide also takes far longer than an API request may run. Another agent owned migrations in this run, so the state had to fit the existing tables.

## Decision

1. `parfocal_common.link_fetch` is the only way Parfocal opens a link. It resolves the host itself and refuses the link when any resolved address is not global, which covers loopback, private, link-local (cloud metadata), shared, reserved, multicast and IPv4-mapped IPv6 addresses. It then connects to the checked address with the original `Host` header and TLS name, so a DNS answer that changes between the check and the connect cannot rebind it.
2. Redirects are followed by hand, at most 5, and every hop is checked again. Only `https` is allowed. A fresh HTTP client with no default credentials, no cookies and `trust_env` off is used, so no platform credential or proxy setting reaches the link.
3. Size is capped twice: a listed file larger than `upload_max_bytes` is listed as refused and never imported, and while fetching the worker stops as soon as the body passes the size the listing announced. `link_read_seconds` bounds each read and `link_fetch_seconds` the whole fetch.
4. `link_trusted_origins` (exact `host:port`, empty by default) skips the address check and allows plain `http` for that origin only. Tests use it for the local test HTTP server. Production leaves it empty.
5. The API lists the link (`GET /api/projects/{project_id}/source-files`, `listSourceFiles`) and sorts the names with the same case sorting and result pairing as dropped files. `POST /api/projects/{project_id}/link-imports` (`importFromLink`) lists the link again on the server, never trusting addresses from the browser, creates ordinary open upload rows in the quarantine of INGEST-001 (upload API with presigned multipart) and queues one `link-fetch` job per file.
6. The `link-fetch` job in the ingest worker streams the file into the upload's multipart object with a SHA-256, leaves the slide out with the reason `duplicate` when a live slide in the project has the same checksum, and otherwise completes the upload through the same `close_upload` as a browser upload, so the ingest workflow of INGEST-003 (ingest workflow skeleton) and the result import follow unchanged.
7. No migration. The job input holds only the upload ID, as for every ingest job, and the link address waits in storage next to the quarantine object (`t/{tenant}/quarantine/{upload}.link.json`) and is deleted when the fetch ends. A refused fetch marks the upload aborted, and the status route reads the reason from the failed `link-fetch` job.

## Alternatives

- Fetching inside the API request was simpler but cannot carry a 20 GB slide within a request time limit and stops when the API scales down.
- Checking the address only before handing the URL to a normal client leaves a DNS rebinding gap and lets redirects reach internal addresses.
- A `source_url` column on `uploads` and an upload status for a left-out copy are cleaner to query, but need a migration. They can replace the storage object and the job lookup later.

## Consequences

- Every outbound fetch of user-given links must go through `open_link`. A future source such as INGEST-026 (saved import sources) reuses it.
- A presigned or SAS address is stored for the length of the fetch in the quarantine prefix, which only the platform reads.
- A left-out copy reads as `failed` with `duplicate` on the upload status. TODO for the owner: whether a left-out copy gets its own status wording in the jobs tray.
- GCS, DICOMweb and SFTP links, folders inside folders and pages past the first listing page are not read yet.
