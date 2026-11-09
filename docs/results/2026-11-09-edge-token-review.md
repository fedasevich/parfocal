# Result: edge token review of 2026-11-09

- Date: 2026-11-09
- Backlog: SEC-036 (a removed person cannot rejoin a room), SEC-037 (caps on room sockets), SEC-038 (keys of at least 32 bytes), SEC-039 (security headers after a throw), SEC-040 (presence in a blinded task), SEC-041 (closed range check and the token's size) and SEC-042 (edge limits guard the real API path)
- Kind: check
- Commit: ba45feb5
- Environment: the owner's Mac, read-only
- Data: `apps/edge/src` and the token issuers in `apps/api`

## Question

Can a request read slide bytes or join a room without a valid token for that workspace and object.

## Method

A read-only review by an agent. Nothing in the repository was run. Each finding becomes a fix only after a failing test reproduces it.

Read-only review on 2026-11-09 of `apps/edge/src`, the token issuers in `apps/api/src/parfocal_api` and the three decisions behind them: ADR 0137 (capability tokens for slide bytes), ADR 0140 (realtime rooms and room tokens) and ADR 0269 (realtime event model by room and kind). No file in the repository was created or changed, and no test, server, wrangler or docker command was run. Besides reading, I ran two `node -e` one-liners and one `python3 -c` one-liner that import nothing from the repository, and one search of the public Cloudflare documentation. Each is named where it is used.

## Result in short

The invariant held against everything I tried. I found no request that reads a slide byte or joins a room without a valid, unexpired token signed by the API for that tenant and that object, and nothing a client sends widens a token. There is no high finding.

There are 5 confirmed findings, all low, and 2 suspicions (1 low to medium, 1 low). The confirmed ones are about what happens around the token check (removal, floods, key hygiene, error paths, presence), not about the check itself.

| # | Kind | Severity | Title |
|---|---|---|---|
| C1 | Confirmed | Low | A removed person can rejoin a room with the room token they still hold, and a revoke can miss a socket |
| C2 | Confirmed | Low | Rooms have no connection cap, no frame rate cap and no edge limit, and the internal route reads the whole body before checking the signature |
| C3 | Confirmed | Low | The API signs tile tokens with an empty HMAC key when `TILE_TOKEN_KEY` is empty or a placeholder, and neither side enforces a key length |
| C4 | Confirmed | Low | A thrown error, such as `GET /rt/%zz`, returns the platform error page without the security headers |
| C5 | Confirmed | Low | A reviewer in a blinded task receives presence events that name the other people on the slide, and no decision covers it |
| S1 | Suspicion | Low to medium | The edge login and upload limits and the Turnstile check guard paths the Worker never forwards to the API |
| S2 | Suspicion | Low | The closed range check trusts the size in the token, so it is skipped or misaligned if the stored object is ever larger |

## Confirmed findings

Each of these was traced through the code from the request to the effect.

### C1. A removed person can rejoin a room with the room token they still hold, and a revoke can miss a socket

| Field | Detail |
|---|---|
| Severity | Low. The extra access lasts at most five minutes and carries ids and kinds only. It still contradicts ADR 0140 (realtime rooms and room tokens), which says a removed person stops receiving events at once when the revoke lands, and threat R2 (a socket stays open after its owner leaves). |
| Where | `apps/edge/src/realtime.ts:66-88` (the join checks signature, expiry and room name only), `apps/edge/src/room.ts:193-199` (`closeUser` closes sockets and remembers nothing), `apps/edge/src/room.ts:232-246` (`remember` overwrites `joined:{room}` and `joined` drops entries by their stored expiry), `apps/edge/src/realtime.ts:80-85` (the index write is deferred and its failure is swallowed). |
| Sequence 1, rejoin | Anna calls `GET /api/rooms/slide:{id}/access` and joins `GET /rt/slide:{id}`. The owner calls `removeProjectMember`. The API posts `/rt-internal/revoke` and the socket closes with 4403. Anna's client opens `GET /rt/slide:{id}` again with the same token in `Sec-WebSocket-Protocol`. The Worker answers 101, because the token is still signed and unexpired, and the room sends her events until the token's `e`. |
| Sequence 2, missed socket | Anna joins with token T1 (expires at 300) and renews with T2 (expires at 450), so the index says 450. She opens a second socket with T1, which is still valid, and the deferred `/join` call overwrites the index entry with 300. A revoke at 310 finds the entry stale, deletes it and closes nothing, while the first socket lives until 450. The same happens when the deferred `/join` call fails. |
| Why the tests miss it | `apps/edge/test/rooms.test.ts:509` and `:530` assert the close code only. No test joins again after a revoke, and no test joins the same room twice with tokens of different expiry. |
| Test to write | In `apps/edge/test/rooms.test.ts`: "a removed person cannot rejoin with the token they still hold". Join, post the revoke, join again with the identical token and expect a refusal (403 `room-access-revoked`) and no event delivered. Add "an older token joining later does not hide a newer socket from a revoke". |
| Smallest fix | Let the user room keep the revoke. `/joined` (called by the revoke) stores `revoked:{project or all}` with the current time. `handleConnect` awaits the user room's `/join` call instead of deferring it, and the user room refuses when a matching revoke is newer than `expires - 300`, which is the latest moment the token can have been issued. `renew` already calls `/join` and takes the same answer. In `remember`, keep the later of the stored and the new expiry. |

### C2. Rooms have no connection cap, no frame rate cap and no edge limit, and the internal route reads the whole body before checking the signature

| Field | Detail |
|---|---|
| Severity | Low. It is a cost and availability exposure on an account the owner pays for, not a read. Threat R5 (floods of connections or frames) lists "per user connection limits" as the mitigation, and none exists. |
| Where | `apps/edge/src/rate-limits.ts:34-40` (only login, upload writes and `/tiles/` have a class), `apps/edge/src/room.ts:137-157` (`join` accepts every socket), `apps/edge/src/room.ts:248-266` (every `ping` and `renew` frame wakes the object, with no rate cap), `apps/edge/src/realtime.ts:125-127` (`request.text()` runs before `verifyPublish`). |
| Sequence 1, member | Any workspace member gets one room token, which is reusable for five minutes, opens thousands of sockets to `/rt/slide:{id}` with it and sends `{"type":"ping"}` in a loop on each. Every frame runs `webSocketMessage` in the object. From memory of the platform, and unverified here, incoming frames are billed and one object holds a bounded number of sockets, so the room can be filled and other readers locked out of that slide's room. |
| Sequence 2, anyone | Without any token, post a body of many megabytes to `/rt-internal/publish` repeatedly. The Worker buffers each body before it answers 401. With a well-formed `X-Room-Signature` header that carries the current time and any signature, it also hashes the whole body (`room-token.ts:122-134`). No limit class covers the path. |
| Why the tests miss it | `apps/edge/test/rate-limits.test.ts:45` asserts that everything except login, uploads and tiles is unlimited, so the gap is the tested behaviour. The room tests open at most a handful of sockets. |
| Test to write | In `apps/edge/test/rooms.test.ts`: "the ninth socket of one person in one room is refused". In `apps/edge/test/rate-limits.test.ts`: "room joins and internal room calls are counted", which asserts that `limitClassOf("GET", "/rt/slide:...")` and `limitClassOf("POST", "/rt-internal/publish")` are not null. In `rooms.test.ts`: "an internal call with no signature header or an oversized body is refused before the body is read". |
| Smallest fix | In `Room.join`, refuse when `getWebSockets(userTag(seat.user)).length` is at or over a small cap such as 8. Add `/rt/` and `/rt-internal/` to `limitClassOf` under the tile binding or a new one. In `handleInternal`, check the signature header's shape and a `Content-Length` of at most 64 KiB before reading the body. The platform's automatic ping reply (`setWebSocketAutoResponse`, named from memory) would keep pings from waking the object. |

### C3. The API signs tile tokens with an empty HMAC key when `TILE_TOKEN_KEY` is empty or a placeholder, and neither side enforces a key length

| Field | Detail |
|---|---|
| Severity | Low. It needs a misconfigured environment, and Node, the one runtime I could try, refuses an empty key. It is listed because the two issuers disagree and the failure is silent. |
| Where | `apps/api/src/parfocal_api/tile_access.py:156` checks only `is None`, while `apps/api/src/parfocal_api/room_access.py:125` also refuses an empty value. `tile_access.py:59-60` (`key_of`) decodes without validation, so Python drops every character outside the base64 alphabet. `apps/edge/src/capability.ts:42-50` (`signingKey`) accepts any non-empty key, even a single byte. |
| Sequence | Set `TILE_TOKEN_KEY=` (empty) or a placeholder such as `...` in the API environment. `ApiSettings` has no rule that turns an empty value into `None`. `GET /api/slides/{id}/tile-access` answers 200 with a token signed with the key `b""`. I confirmed with one `python3 -c` call that `base64.urlsafe_b64decode("")` and `("!!!")` both give `b""` and that `hmac.new(b"", ...)` signs. Anyone can now compute that signature, so a caller forges a `Previous-Tile-Token` with their own `v`, `t`, `s` and `a` and mints tokens without the `slide.opened` audit entry (`tile_access.py:92-101` and `:168`). If the Worker held the same empty key and accepted it, any tile token could be forged. |
| What I could not prove | Whether workerd imports a zero-length HMAC key. Node refuses it (`DataError: Zero-length key is not supported`, one `node -e` call), and the WebCrypto text says the same, so the Worker most likely answers 500. A short key such as one byte is accepted by both sides for certain. |
| Why the tests miss it | `apps/api/tests/test_tile_access.py:183-189` covers only `tile_token_key=None`. The edge tests always use a 32-byte key. |
| Test to write | In `apps/api/tests/test_tile_access.py`: "an empty, placeholder or short tile key answers 503 `tile-access-not-configured`", parametrised over `""`, `"..."` and a 4-byte key. In `apps/edge/test/tiles.test.ts`: "a key under 32 bytes is refused by `signingKey`". |
| Smallest fix | Make `key_of` decode with `validate=True` and raise unless the key is at least 32 bytes, and treat that as not configured in both `get_tile_access` and `get_room_access`. Make `signingKey` throw under 32 bytes. |

### C4. A thrown error returns the platform error page without the security headers

| Field | Detail |
|---|---|
| Severity | Low. Nothing is read. One response path skips COOP, COEP, CORP, `nosniff` and HSTS, which the header decision (ADR 0156, security headers in the edge Worker) says every response carries. |
| Where | `apps/edge/src/realtime.ts:40` (`decodeURIComponent` on the raw path), `apps/edge/src/index.ts:29-34` (no `try` around `guard` and `route`). Other throws take the same path: a missing `TILE_TOKEN_KEY` or `ROOM_TOKEN_KEY` binding (`capability.ts:43`), and an R2 or rate limit binding error. |
| Sequence | `GET /rt/%zz` with no token. `new URL` keeps the bad escape, `decodeURIComponent` throws `URIError` (checked with one `node -e` call), the handler rejects and Cloudflare serves its own 500 page. |
| Why the tests miss it | `apps/edge/test/rooms.test.ts:309` tries missing, expired, forged and wrong-room tokens on well-formed paths only. `apps/edge/test/security-headers.test.ts:96-101` checks headers on problem responses the code builds, never on a throw. |
| Test to write | In `apps/edge/test/security-headers.test.ts`: "a malformed room path is a 404 problem with the isolation headers". It calls the default export's `fetch` with `/rt/%zz` and runs `headerProblems` on the answer. |
| Smallest fix | Catch the decode error in `handleRealtime` and answer 404 `room-not-found`. Wrap `guard` and `route` in `index.ts` in one `try` that turns any throw into `problem(500, "edge-error", ...)` before `withSecurityHeaders`. |

### C5. A reviewer in a blinded task receives presence events that name the other people on the slide, and no decision covers it

| Field | Detail |
|---|---|
| Severity | Low. The event holds a user id and nothing about anyone's work. It is listed because the brief's rule is that a blinded reviewer receives no event of another reviewer, and the code sends one. Whether it matters is a product choice for the owner. |
| Where | `apps/edge/src/room.ts:137-155` (`join` sends the newcomer every present user and tells everyone of the newcomer, in every room kind, with no blinding input), `apps/api/src/parfocal_api/room_access.py:61-81` and `:107-110` (a slide or task room token is issued on the reading check alone, and the token has no field that says the holder is blinded). |
| Sequence | Anna and Ben are assigned the same slide in a blinded review task, and neither has submitted. Both call `GET /api/rooms/slide:{id}/access` and join. Anna's socket receives `{"type":"event","kind":"presence.joined","ids":{"user":"<Ben>"}}`, and later `presence.left`, so she learns that Ben is reading this slide now and for how long. The project room gets the same pair with the slide id, but only whole-project readers may join it. |
| What the decisions say | ADR 0118 (blinding and a kept first read) leaves progress open: who is assigned and who has submitted. Presence came later, in the COLLAB-007 (presence) amendment of ADR 0140 (realtime rooms and room tokens), and neither it nor ADR 0269 (realtime event model by room and kind) says how presence meets blinding. ADR 0269 lists presence for slide and project rooms only, while the code also announces it in task and user rooms. |
| Why the tests miss it | The presence tests at `apps/edge/test/rooms.test.ts:399-476` have no blinded seat, because a seat cannot express one. The API tests for room access check who may join, not what a blinded joiner then hears. |
| Test to write | In `apps/api/tests/test_realtime.py`: "a reviewer with an unsubmitted assignment in a blinded task gets a room token marked quiet". In `apps/edge/test/rooms.test.ts`: "a quiet seat neither hears presence nor is announced". |
| Smallest fix | Put the question in `docs/decisions.md` first. If the answer is to hide it, add an optional claim to the room token, set by the API from `blinding.blinded_on`, and have `Room.join`, `leave` and `tellProject` skip presence to and about a seat that carries it. Limit presence to slide and project rooms as ADR 0269 says. |

## Suspicions

These could not be proven by reading alone.

### S1. The edge login and upload limits and the Turnstile check guard paths the Worker never forwards to the API

| Field | Detail |
|---|---|
| Severity | Low to medium. It depends on how production routes `/api`, and it does not touch slide bytes or rooms. |
| Where | `apps/edge/src/index.ts:37-54` has branches for `/tiles/`, `/rt/`, `/rt-internal/` and the data prefixes, and everything else goes to `ASSETS`. There is no `/api` branch and no API origin in `EdgeEnv`. `infra/tofu/cloudflare.tf` defines buckets and zone settings and no Worker route. `apps/web/vite.config.ts:88` proxies `/api` only in local development. |
| What it would mean | `guard` counts `/api/auth/login`, `/api/auth/callback` and upload writes (`rate-limits.ts:26-40`), then the Worker answers them with the app page. Wherever FastAPI is really reachable, such as its Modal address or a separate route, requests do not pass `guard`, so the per-address limits and the bot check of SEC-027 (edge limits per IP) protect nothing, while ADR 0088 (rate limits in Postgres and at the edge) and `docs/knowledge/platform.md` describe them as in force. |
| Related, same file | The limits fail open when a binding is absent (`rate-limits.ts:93-97`, asserted as intended at `rate-limits.test.ts:107`), and the repository holds only the `parfocal-edge-dev` wrangler config, so a production config that forgets `ratelimits` limits nothing and no test notices. The login match is exact (`rate-limits.ts:26` and `:35`), so once a proxy exists, `/api/auth/login/` or a percent-encoded variant is uncounted if the API router still accepts it. `TRUST_TEST_CLIENT_ADDRESS` is read only from the environment, is absent from `wrangler.jsonc` and cannot be switched on by a request, so address spoofing needs a bad deploy. |
| Why the tests miss it | `apps/edge/test/rate-limits.test.ts` calls `guard` and the Worker with a fake `ASSETS` and asserts the 429, never that a request under the limit reaches an API. I did not search the backlog for a pending proxy task, so this may be known work. |
| How to prove it | Read the deployed route table, or run `apps/edge/test/deployed-rate-limits.test.ts` against staging and then send the same flood straight to the API address. |
| Test to write | In `apps/edge/test/worker.test.ts`: "a request to `/api/health` is forwarded to the API origin, never answered with the app page". In the deployed check: "the API address refuses a request that did not come through the Worker". |
| Smallest fix | Add the `/api` proxy branch with an `API_ORIGIN` variable and make the API accept only requests that carry a Worker-held shared secret header. Make `guard` answer 503 when a limit class has no binding and the environment is not marked local. Normalise the path (lowercase, strip the trailing slash) before `limitClassOf`. |

### S2. The closed range check trusts the size in the token, so it is skipped or misaligned if the stored object is ever larger

| Field | Detail |
|---|---|
| Severity | Low. I found no way to make the two sizes differ today. |
| Where | `apps/edge/src/tiles.ts:91-102` (`bounds` returns null when the offset is at or past the size it is given), `apps/edge/src/tiles.ts:271-275` (a null `wanted` skips `overlapsRestricted`, and the size given is the token's `n`), `apps/edge/src/tiles.ts:215` (R2 then resolves suffix and open-ended ranges against the real object). `apps/edge/src/capability.ts:71` accepts a negative `n`. |
| Sequence, if the object were larger | Object of 10,000 bytes, token with `n` 4,000 and closed range 4,000 to 5,000. `Range: bytes=4500-4600` gives a null `wanted`, no check, and R2 serves the closed bytes. `Range: bytes=-5500` is checked as 0 to 4,000 and served as 4,500 to 10,000. `Range: bytes=3000-` is checked as 3,000 to 4,000 and served to the end. |
| Why it is only a suspicion | `n` is `uploads.size_bytes`, which the API checks against the stored parts at completion (`uploads.py:327`, `parts_problem`), and the publish step copies exactly that many bytes (`workers/ingest/.../workflow.py:327-330`). The Cloudflare reference does not say what an R2 read with an offset past the end returns, so the equal-size case rests on the Worker's own 416 at `tiles.ts:226-230`, which is sound. |
| Why the tests miss it | `apps/edge/test/tiles.test.ts:316` always signs `size` equal to the object's length. |
| Test to write | In `apps/edge/test/tiles.test.ts`: "a token whose size is smaller than the stored object never reads a closed range", with the three ranges above, expecting 403 or 416 and no bucket read. |
| Smallest fix | When the name is the original and `bounds` is null, answer 416 before touching R2. Pass R2 the explicit `{offset, length}` computed from `wanted` instead of the client's span, and refuse when `object.size` differs from `capability.size`. Require `n >= 0` in `capabilityOf`. |

## What I checked and found sound

Token format and verification, items 1 and 2 of the brief.

- Both tokens are `base64url(payload).base64url(HMAC-SHA256(key, payload text))`. The MAC covers the encoded payload text, so there is no canonical form or separator to attack. The Worker compares with `crypto.subtle.verify` and the API with `hmac.compare_digest`, which are both constant time. Signature bytes are malleable in base64 (unused bits, and Python ignores stray characters), which changes nothing that is signed.
- The Worker verifies before it parses, and refuses a wrong version, a missing field, a bad range pair or a folder outside `samples/camelyon16/{label}/` as malformed (`capability.ts:61-88`). Expiry is `e <= now` on the Worker's clock. There is one key and no key id, which ADR 0137 accepts.
- A tile token is never a room token and the reverse, even with the same key, because each parser requires fields the other lacks. The publish signature covers `publish.{seconds}.{body}`, which can never equal a token's signed text, since a token payload holds no dot.
- The Python signer and the TypeScript parser agree on every field. The Worker ignores `a` (the viewer hash), which only the API uses.
- The R2 key is `t/{tenant}/s/{slide}/{name}` or the signed sample folder plus the name, built from the token. The URL contributes only the file name, limited to `[A-Za-z0-9][A-Za-z0-9._-]{0,99}`, and a slide id that must equal the token's. `..`, encoded slashes, double encoding, a trailing slash, a different case, backslashes and a doubled leading slash all end in 403, 404 or the app page with no bucket read. There is no prefix match and no listing, so no sibling key can satisfy a token.
- The direct children of a slide folder are the original, `levels.json` (geometry only), `overview-levels.tiff`, `tile-index.json`, `thumbnail.jpg`, `overview.jpg` (made by `previews` from a region of the pyramid it is handed, and I did not read `region_for`, `overview_levels` or `tissue_mask` to the bottom), `tissue.png`, `tissue.json` and `restricted-ranges.json`. Label and macro files live under `t/{tenant}/restricted/{slide}/`, and AI results and runs live in subfolders, none of which a file name without a slash can reach.
- No API route presigns a read URL. Only part uploads are presigned, and the bucket CORS rule allows only PUT.

Order, cache and ranges, items 3 and 4.

- In `handleTiles` the order is name, method, token, slide, range, closed ranges, then the read. HEAD and GET share it. OPTIONS and other methods get 405 before any read. Conditional headers are ignored. Several ranges, an empty range and a reversed range get 416.
- The production Worker passes no cache (`index.ts:44`). The RangeCache runs only in `tile-spike.ts`, switched by an `X-Spike-Cache` request header on the spike Worker. In the code path, the token and the closed range check both come before the lookup, the key holds the tenant, slide, file, offset and length, suffix and open-ended ranges skip the cache, and only 200 and 206 are stored, so a 403, 404 or 416 is never cached and a cached reply cannot cross objects.
- Two things to settle in the ADR before the cache is wired: entries live 24 hours with no object version in the key, so bytes of an erased or replaced object stay in Cloudflare's cache for a day, and a whole-file GET tees a body of any size into `cache.put` (`tiles.ts:162-170`).
- `Content-Range` and `Content-Length` are computed from the real object size in `serveFromBucket` and match the body the fake and the documented R2 range rules return. Huge numbers parse to values at or past the size and end in 416 or an R2 error, never in other bytes.
- Whole-object GETs stream, so there is no buffering amplification. The one buffering path is the HTML nonce swap, and no slide object is stored as `text/html`: ingest sets fixed types and uploads set none.
- Tile responses say `private, max-age=3600`, but the viewer fetches with `cache: "no-store"` (`packages/viewer-engine/src/access/tile-access.ts:77`) and sends the token only in the `Authorization` header, so nothing lands in the browser cache or a URL.

Rooms, item 5.

- The Durable Object name comes from the token's tenant and room. The URL room must equal the token's. The Worker overwrites `X-Room-Seat`, so a client cannot supply a seat, and the object is reachable only through the Worker.
- A client frame is `ping`, `renew` or ignored. Nothing a client sends is passed on, and no user id, tenant id or event kind is read from a frame. A renewal must match tenant, room and user. Frames over 4,096 characters and binary frames close the socket.
- After expiry, `broadcast` and presence both skip the socket (`room.ts:185` and `:206`), so an expired socket receives nothing even if an alarm is late, and the alarm closes it with 4401.
- Blinded work is kept by the API, not the room. `annotate_layer.announce` sends a change to a hidden object to its author's user room only (rule B of ADR 0278, blind first on annotate tasks), soft deletes included. Every other API event is ids only, and the refetch applies the blinding rules. Presence is the exception, described in finding C5 (presence events in a blinded task).

API side, item 6.

- `get_tile_access` needs `see-slides`, a live slide, and `require_slide_reading` (whole-project reader, an unreleased assignment on that slide, or an open emergency grant). Lifetime is 600 seconds. The query has no tenant filter of its own, and the token's tenant is the slide row's. The only tenant boundary at mint is therefore `tenant_connection` (`context.py:31-46`), which opens a transaction scoped to the principal's tenant, so this issuer is exactly as tenant-safe as row-level security. A service account passes `project_grant` on its workspace grant alone, with no project membership. I passed this dependency to the tenant isolation review.
- `get_room_access` is the one issuer without a `require(...)` wrapper. The wrapper would only add the workspace-level `see-slides` grant check. The slide and project branches repeat it inside `project_grant`. The task branch can pass on the caller's own unreleased assignment after `visible()`, and the user branch needs no grant. User rooms must be the caller's own, project rooms need a whole-project reader, slide rooms the slide reading check, and task rooms `readable_task` with an unreleased assignment. Service accounts are refused. Lifetime is 300 seconds.
- Report links (`report_links.py`) are 256-bit random tokens stored hashed, limited per link, refused for suspended tenants, revoked, expired and deleted projects, and they return numbers and names only. They mint no tile or room token.

Headers, item 8.

- The nonce is 16 random bytes per document, swapped only into `text/html` responses, which are the static app page. No user-controlled text reaches an HTML response. The 101 upgrade is passed through untouched. Every problem response the code builds gets the static headers.

## Accepted by a decision, so not findings

- A tile token is a bearer token at the edge, not bound to a user, and a removed reader keeps reading for up to ten minutes (ADR 0137, capability tokens for slide bytes, and threat T3, a removed reader keeps reading).
- A lost revoke leaves a socket open for up to five minutes, and a released assignment or a role change sends no revoke (ADR 0140, realtime rooms and room tokens).
- One audit entry per viewing session, and a renewal that hands back the token it replaces records nothing (ADR 0137, capability tokens for slide bytes).
- Identifying text and barcodes in file headers are readable by every token holder today, because ingest closes only image data (`workers/ingest/src/parfocal_ingest/restricted_ranges.py:24-41`). This is known and waits on SEC-028 (identifying text in de-identified originals), which is still open and names SVS, NDPI, Philips and DICOM text and the Leica SCN barcode (decision 17a, barcodes in file headers). The Ventana BIF XMP packet may hold a barcode too, from memory of the format, and the task does not name it.
- Progress, meaning who is assigned and who has submitted, is not blinded (ADR 0118, blinding and a kept first read). Presence is not covered by that sentence, which is finding C5 (presence events in a blinded task).
