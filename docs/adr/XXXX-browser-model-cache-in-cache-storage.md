# XXXX. Browser models are cached in Cache Storage, checked by header, and revalidated by ETag in the background

- Date: 2026-11-06
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: AISEG-003 (browser model cache). Builds on [ADR 0250](0250-sam-graph-per-execution-provider.md) (each execution provider loads its own PathoSAM graphs) and [ADR 0148](0148-browser-ml-runtime-onnxruntime-web.md) (browser models on onnxruntime-web)

## Context

The PathoSAM graphs are 11 MB to 101 MB each, and the encoder alone is 73 MB or 101 MB. A user who opens the smart select tool a second time must not download them again, and a half-written or replaced cache entry must never reach the inference session.

## Options considered

1. Cache Storage with one entry per graph URL.
2. IndexedDB blobs.
3. The origin private file system.
4. Rely on the HTTP cache.

## Decision

Option 1. Cache Storage is available in workers, stores a `Response` with its ETag and length, and is evicted as one origin bucket that `navigator.storage.persist()` can protect. The HTTP cache (option 4) is evictable without notice and cannot be checked or repaired by code. IndexedDB (option 2) and the file system (option 3) need more code for the same result.

The loader in `packages/viewer-engine/src/sam/model-cache.ts` works like this.

- A cached entry is served first. A background request with `If-None-Match` then confirms it. A 304 or an equal ETag changes nothing, and a new body replaces the entry for the next load. A failed revalidation keeps the cached model.
- An entry stored without an ETag is never revalidated, because a full re-download on every load would cost more than a stale model.
- Every body is checked before it is cached or served. It must match the declared length, and its first bytes must be a valid `ModelProto` protobuf tag (an `ir_version` between 1 and 32 first, or another known `ModelProto` field). An HTML error page or a captive portal page fails this check.
- A cached entry that fails the check is deleted and downloaded again, and the load reports that it replaced a corrupt entry. A download that fails the check is never stored.
- Persistent storage is requested once, before the first write. A refusal is ignored.
- The load reports "Loaded from cache" or "Downloaded N MB" for the interface.

## Consequences

- A cached model may be one version old for one session. A new graph reaches the user on the following load.
- The header check catches wrong content and truncation but not a flipped byte inside the weights. The ETag compares the stored entry with the server, not the bytes with a hash.
- The inference worker (AISEG-004) passes the browser's `caches`, `fetch` and `navigator.storage` into `createModelCache`, which keeps the loader testable with small fake blobs.
