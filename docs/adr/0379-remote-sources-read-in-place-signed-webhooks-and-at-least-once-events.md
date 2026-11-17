# 0379. Remote sources are read in place through a tile cache, webhooks are signed with HMAC and events are delivered at least once

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: REMOTE-000 (research check), for REMOTE-001 (read in place from a connected source), REMOTE-002 (webhook in per project), REMOTE-003 (events out) and REMOTE-004 (watched folder or bucket)

## Context

The REMOTE epic has three parts that each cost a lot to undo once a customer pipeline depends on them. Read in place must stream tiles from a source Parfocal does not own and still open when that source is down. A webhook in must prove who called it. Events out must tell a pipeline what happened without losing or duplicating work silently.

What exists today. Saved import sources ([ADR 0378](0378-saved-import-sources-keep-credentials-on-the-server.md), saved import sources keep credentials on the server) store an HTTPS or object storage address and a credential sealed with the tenant data key. Every outbound request goes through the address check of [ADR 0245](0245-link-imports-fetched-by-the-worker-behind-an-address-check.md) (link imports fetched by the worker behind an address check). Notifications are rows written in the caller's transaction with email sent after commit ([ADR 0074](0074-notifications-as-rows-with-an-email-outbox.md), notifications as rows with an email outbox), and `integration-down` is already a notification kind ([ADR 0091](0091-notification-catalogue-and-targets.md), notification catalogue and targets). Background work runs as Postgres jobs with leases ([ADR 0044](0044-background-jobs-and-workflows.md), background jobs and workflows). The audit log is a hash chain ([ADR 0027](0027-audit-log-hash-chain-in-postgres.md), audit log hash chain in Postgres). No webhook or event delivery code exists in `apps/api`.

## Decision

### Read in place

1. A remote slide keeps its row, its ID and its reviews. Only its storage differs: `storage` is `uploaded` or `remote`, and a remote slide holds the source ID and the object path. Copy into Parfocal later changes `storage` and nothing else, which is how IDs and reviews survive.
2. Tiles are read from the source with ranged requests through the same address check and sealed credential as ADR 0378. The browser never sees the source address or credential. Tile requests go to Parfocal, which reads the range, decodes it with the same readers as uploaded slides and answers.
3. Fetched ranges are cached in Parfocal storage under the tenant prefix, keyed by source, object path and the source's ETag (or its modification time when there is no ETag), with a 7 day time to live counted from the last read. A changed ETag is a different key, so a replaced file never serves old tiles. The cache holds tiles and pyramid headers only, never a whole file, so reading in place still copies nothing in the sense of the product.
4. When the source answers with an error or times out three times in a row, the slide gets the offline state. Tiles that are in the cache are still served and everything else shows the offline message. Offline clears on the next successful read. A source that stays down for 15 minutes writes one `integration-down` notification, and a cache entry is never extended by a failure.
5. Result files next to a slide are always imported, as the task says, so reviews never depend on the source being up.
6. Removing a source marks its remote slides offline and keeps the cache until it expires. It does not delete slides.

### Webhook in

1. Each project has a webhook URL with a random 128 bit ID. The ID only finds the project. It grants nothing.
2. The caller signs the raw request body with HMAC SHA-256 and a per project secret, and sends `Parfocal-Timestamp` (Unix seconds) and `Parfocal-Signature` (`v1=` and the hex digest of `timestamp.body`). Parfocal checks the digest in constant time and refuses a timestamp more than 5 minutes away from its clock, which stops replays of old captures.
3. A caller may send an `Idempotency-Key` header. A repeated key within 24 hours returns the first answer and does nothing twice.
4. The secret is sealed with the tenant data key like source credentials, is shown once when created, and a project may hold two secrets at once while one is rotated out. Verification tries both.
5. Slide and result links in the body go through the same link import and address check as a person's links. The call answers what was done in a body of per link outcomes. Every call, including a refused one, writes an audit event with the project, the outcome and the signature check result, and never the secret, the body or a link's query string.
6. Failed signature checks answer with the same 401 whatever the reason, and a project gets at most 60 calls a minute.

### Events out

1. Events are `review-submitted`, `task-disagreements`, `task-signed-off` and `result-set-added`, `result-set-signed` and `result-set-retried`. The body holds IDs, the kind and a time, and never names, patient data or review text, because the receiver is outside Parfocal.
2. An event is written to an `event_outbox` table in the same transaction as the change that caused it, as notifications are in ADR 0074. A job with a lease then delivers it, so nothing is announced that did not commit.
3. Delivery is at least once. A 2xx answer within 10 seconds counts as delivered. Anything else is retried with growing waits (1 minute, 5 minutes, 30 minutes, 2 hours, 12 hours), then the event is marked failed. Receivers must tolerate duplicates, and each event carries a stable `Parfocal-Event-Id` for that. Order is kept per project only as a best effort and each event carries a sequence number so a receiver can tell.
4. Each target has its own signing secret and uses the same scheme as the webhook in, with the same header names, so a receiver verifies both with one function. A target address is checked like any link, and plain http is refused.
5. A target that fails five events in a row is paused and opens an `integration-down` target for the notification resolver. Every attempt is logged with status and duration, and a person can replay a failed event.

## Alternatives

- Copying every remote slide on first open is simpler and offline safe, but it is the copy the user chose not to make, and it multiplies storage by the size of the archive.
- Caching whole files would give a perfect offline state but makes every open a full download.
- A bearer token in the webhook URL or header is easy to call, but it travels with every replay and leaks through logs, while a signature does not reveal the secret.
- Asymmetric signatures (Ed25519) avoid sharing a secret, but pipelines in labs are mostly scripts that already have HMAC, and the shared secret fits the sealed storage we already have.
- Exactly once delivery cannot be promised over HTTP. At least once with an event ID is what receivers can actually check.
- A message broker for events is not justified at this volume, as ADR 0074 and ADR 0044 already found for email and jobs.

## Consequences

- REMOTE-001 adds the `storage` column and the tile cache. It needs TILES-001 for the shared readers. The storage filter in All slides reads `storage`.
- REMOTE-002 adds a secret table and the webhook route. REMOTE-003 adds `event_outbox`, the delivery job and the target table. Both need migrations, so they take the next free numbers when they land.
- The audit names for webhook calls and event deliveries go in the permission and audit tables with each task, and none contains the word "verdict".
- ADMIN-006 (storage, sources, API and webhooks) shows the secret once, rotates it and lists the delivery log.
- Open choices the owner may change later without a rewrite: the 7 day cache time, the 5 minute clock skew, the retry waits and the 60 calls a minute.
