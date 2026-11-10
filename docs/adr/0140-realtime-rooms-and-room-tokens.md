# 0140. Realtime rooms are Durable Objects named by tenant and room, joined with a five-minute room token offered as a WebSocket subprotocol

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: COLLAB-001 (realtime infrastructure). Builds on [ADR 0003](0003-pilot-platform-architecture.md) (pilot platform architecture) and [ADR 0137](0137-capability-tokens-for-slide-bytes.md) (capability tokens for slide bytes). Touches HOME-007 (activity on the launchpad and in notifications), WL-016 (realtime worklist updates) and BOARD-011 (realtime board)

## Context

ADR 0003 puts realtime in Durable Objects with WebSocket Hibernation as ephemeral fan-out, with the API signing a short-lived token that the edge checks without a database. The threat model asks that a client never joins another tenant's room (R1), that a socket closes when its owner leaves a project or the workspace (R2), that events carry ids and kinds only (R3) and that clients cannot send events (R4). Nothing chose how a browser hands the token over, how long a socket lives, how the API reaches the rooms or how a removal finds the sockets to close.

## Options considered

### How the browser hands over the token

1. As the second entry of `Sec-WebSocket-Protocol`, after the fixed name `parfocal-room-v1`. Browsers allow it, it is refused before the upgrade, and it stays out of URLs and access logs.
2. In the query string. Simple, but it lands in logs and `Referer`, which threat model T2 (leaked token) already warns about.
3. In the first frame after the upgrade. Keeps headers clean, but every unauthenticated socket reaches the Durable Object and holds it until a timeout.

### How long a socket lives

1. The room token lasts five minutes. The client sends a `renew` frame with a fresh token from the API at half its lifetime, and the room closes any socket whose token ran out with code 4401. Every renewal goes through the API, which rechecks the grant.
2. The socket lives until it closes, with the grant checked only at connect. A removed person who misses the revoke call keeps receiving events.
3. The socket closes every five minutes and the client reconnects. Always rechecked, but each reconnect makes the screen refetch.

### How a removal finds the sockets

1. Each person's own room keeps a short index of the rooms they joined, with project and expiry, written by the edge on connect and on renewal. A revoke reads that index and closes the person's sockets in those rooms, all of them for a workspace removal and only that project's for a project removal.
2. The API lists every slide and task of the project and calls each room. A large project means thousands of calls for one removal.
3. A per-tenant registry room. One more hot object per tenant that every connect must reach.

### Where the rooms are tested

1. Plain `node --test` with a fake `DurableObjectState`, as the tile tests fake R2. No new dependency.
2. `@cloudflare/vitest-pool-workers` or Miniflare. Closer to the runtime, but it adds workerd to the lockfile and a second test runner for one app.

## Decision

Option 1 in all four.

| Concern | Rule |
|---|---|
| Rooms | `slide:{id}`, `task:{id}` and `user:{id}`. The Durable Object is `idFromName("{tenant}/{room}")` with both parts taken from the verified token, never from the URL, so two tenants never share an object |
| Token | The ADR 0137 shape, `base64url(payload).base64url(HMAC-SHA256(key, payload))`, payload `{"e", "p", "r", "t", "u", "v"}`: expiry, project or null for a user room, room, tenant, user and version 1. Signed with `room_token_key` (`ROOM_TOKEN_KEY` in the Worker). The edge refuses any payload of another shape, so a tile token is never a room token. `apps/edge/test/room-token-vector.json` is checked by both sides |
| Minting | `GET /api/rooms/{room}/access` (`getRoomAccess`), `Cache-Control: private, no-store`. A slide room needs the slide reading check of `getTileAccess`, a task room the `readable_task` check and a user room must be the caller's own. It returns the token, its expiry, `lifetime_seconds` 300, `path` `/rt/{room}` and `protocol`. Without a key it answers 503 `realtime-not-configured` |
| Joining | `GET /rt/{room}` with `Upgrade: websocket` and `Sec-WebSocket-Protocol: parfocal-room-v1, {token}`. 401 `room-token-missing`, `room-token-invalid` or `room-token-expired`, 403 `room-token-other-room`, 426 without an upgrade, 404 for any other room name |
| Client frames | `ping` gets `pong`, `renew` with a token for the same tenant, room and user extends the socket, anything else is ignored and never passed on. A frame over 4 KiB or a binary frame closes the socket with 1009, a refused renewal with 4401 |
| Events | The API posts `{"tenant", "rooms", "event": {"kind", "ids"}}` to `/rt-internal/publish` with `X-Room-Signature: {unix seconds}.base64url(HMAC(key, "publish.{seconds}.{body}"))`, accepted for 60 seconds. Kinds are dotted lowercase words and ids are up to eight named UUIDs, checked by the API model and again at the edge. Rooms get `{"type": "event", "kind", "ids"}` and clients refetch through the API |
| After commit | Publish and revoke run as FastAPI background tasks, which start after the request's transaction has committed, so a refetch never reads the state before the change. A failed call is logged by name and dropped, because a lost event costs only a refetch |
| Removal | `/rt-internal/revoke` with `{"tenant", "user", "project"}`. `removeProjectMember` revokes the project and `erasePerson` revokes each workspace with project null. The closed sockets get 4403 |
| Client | `RoomClient` in `@parfocal/edge/room-client` asks the API for a token, joins, refetches on every open, renews at half the lifetime, reconnects after a drop with backoff from 0.5 to 30 seconds and a fresh token, and stops when the API refuses a token |

## Consequences

- A removed person stops receiving events at once when the revoke call lands, and within five minutes when it does not, because the next renewal or reconnect is refused.
- The user room's index holds one small entry per room joined in the last five minutes, so a revoke makes as many calls as rooms the person has open.
- Workspace removal is wired only through `erasePerson`, because no route removes a membership yet. The route that does must call `revoke` with project null.
- No event is published yet. HOME-007, WL-016 and BOARD-011 choose their kinds and call `publish` from a background task.
- Deploying needs a wrangler config with the `ROOMS` namespace bound to the `Room` class, the `ROOM_TOKEN_KEY` secret in Cloudflare, and `room_token_key` with `realtime_internal_url` in the API settings, which are production writes for the owner.
- The tests cover the room logic against a fake state, not workerd. The upgrade response with status 101 is not exercised until a Workers test pool or a staging deploy runs it.
- TODO: the number 0140 was free on `origin/main` on 2026-11-02. If another branch takes it first, renumber this record.

- Amended on 2026-11-05 by COLLAB-007 (presence): rooms now send presence events on join and leave, and a `project:` room kind, joinable only by whole-project readers, keeps a short-lived index of who views which slide.

## Update 2026-11-10

SEC-036 (a removed person cannot rejoin a room) closed two gaps the edge token review found. The user room now keeps each revoke for five minutes, and it refuses a join or a renewal whose token was issued at or before the revoke, which it works out as the expiry minus the five-minute lifetime. The edge answers such a join with 403 `room-access-revoked` and closes such a renewal with 4403. The edge now waits for the index write before it opens the socket, so a join whose index write fails is refused instead of being left out of the index. The index keeps one entry per project and room with the latest expiry seen, so an older token that joins later no longer hides a newer socket from a revoke. One gap is left: a revoke that lands between the index write and the socket being accepted misses that socket, which then lives until its token expires, at most five minutes, because its renewal is refused.
