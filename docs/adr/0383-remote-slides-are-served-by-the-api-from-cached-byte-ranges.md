# 0383. Remote slides are served by the API from cached byte ranges

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: REMOTE-001 (read in place from a connected source)

## Context

[ADR 0379](0379-remote-sources-read-in-place-signed-webhooks-and-at-least-once-events.md) (remote sources read in place through a tile cache) says tiles of a remote slide come through Parfocal with a 7 day cache and an offline state. Uploaded slides are served by the edge worker, which hands the browser byte ranges of the original file under a capability token, and the browser decodes the pyramid itself. The edge cannot open a source credential sealed with the tenant data key ([ADR 0378](0378-saved-import-sources-keep-credentials-on-the-server.md), saved import sources keep credentials on the server). A slide also stays closed until its label and macro ranges are known, because a missing ranges document closes the whole file.

## Decision

1. "Tiles" of a remote slide are byte ranges of the original file, decoded in the browser exactly as for an uploaded slide. Nothing new is decoded on the server.
2. `getTileAccess` signs the same capability token with a remote flag and points `base_path` at the public API route `/api/remote-tiles/{slide_id}/`. That route checks the token, refuses ranges that touch label or macro bytes, blanks identifying text, and answers one range of at most 16 MB.
3. Each range is fetched from the source with a Range request through `open_link` and the address check, then stored in Parfocal storage at `t/{tenant}/s/{slide}/remote-cache/{tag}/{offset}-{length}`. The tag is a hash of the source ETag (or its modification time) and the size, so a replaced file never serves old bytes, and the key is deterministic so the edge can serve hits later without the API. The cache is per slide, which maps one to one to the source and object path ADR 0379 names.
4. `slides.remote_read_at` is written at most once an hour, and a sweep removes the cache of a slide unread for 7 days. No row is written per tile.
5. Each mint of a token probes the source with a one byte range. Success pins the size and ETag and clears the failure count. Failure adds one. Three failures in a row, or a removed source, make the slide offline: the token is still signed with the last pinned values, cached ranges are served and everything else answers 503 `slide-offline`. A changed ETag or size answers 409 `remote-slide-changed`.
6. Opening in place (`readInPlace`) checks the chosen names against the source listing, probes each file, creates the slide row with `storage` set to `remote` and no upload, and queues a `remote-inspect` job. The ingest worker reads the file through a ranged file object, identifies it, writes the ranges document and only then publishes the slide. In this version only Aperio SVS, OME-TIFF and generic pyramidal TIFF are read in place. Other formats fail with `remote-format` and must be copied.
7. Migration 0129 adds `storage`, `source_id` (set to null when the source is deleted), `remote_path` (classed as PHI), `remote_etag`, `remote_failures`, `remote_failing_since` and `remote_read_at` to `slides`.

## Alternatives

- Teaching the edge to fetch from the source would keep one tile path, but it would need the tenant data key in the edge or a credential relay, and the edge has no database for the offline state.
- Caching fixed 256 KB blocks would let any range hit the cache, but every viewer range would then cost several storage reads and the edge could not map a browser range to one object.
- Inspecting in the API would avoid a job, but the API image has no TIFF reader and inspection can take many range reads.

## Consequences

- Remote tiles cost an API call on a cache miss and on a hit, until the edge serves deterministic hits. Hits read one object from storage and touch the database at most once an hour.
- Remote slides have no scale (microns per pixel) yet, because the scale reader needs OpenSlide on a local path.
- The browser cannot open a remote slide yet. The viewer first reads `levels.json` (and for some formats the tile index) from the slide folder, so the inspection job must write those files the way ingest does, and the remote route must serve those small files from Parfocal storage as the edge does for uploaded slides. This comes first in what is left.
- Still to build in REMOTE-001 (read in place from a connected source): the remote tag and offline message in the viewer, the storage filter in All slides, copy into Parfocal, importing result files next to a remote slide, the 15 minute `integration-down` notification, wiring the sweep into a scheduled job and re-inspection when a file changes.
