# 0269. Realtime events are ids and kinds posted to project, slide, task and user rooms, and every screen refetches

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: COLLAB-000 (collaboration research check). Confirms STACK-024 (realtime transport) and records the event model of [ADR 0140](0140-realtime-rooms-and-room-tokens.md) (realtime rooms and room tokens) as built and as the remaining COLLAB tasks extend it

## Context

STACK-024 (realtime transport) asked whether Durable Object rooms from [ADR 0003](0003-pilot-platform-architecture.md) (pilot platform architecture) carry presence and thread updates fast enough, against FastAPI WebSockets with Valkey, Centrifugo, Server-Sent Events plus POST and a managed service. The spike in [the realtime latency result](../results/2026-11-02-realtime-transport-latency.md) measured a median of 53 to 63 ms and a p95 of 99 to 141 ms to two browsers on a deployed Worker, with one event of 180 at 551 ms. COLLAB-000 asks to confirm that choice and to write the event model, meaning which rooms exist per tenant, case and user and which events travel on them, before the rest of the COLLAB tasks add more.

## Decision

STACK-024 is confirmed. Durable Object rooms with WebSocket Hibernation stay the transport. Valkey, Centrifugo, Server-Sent Events and managed services stay unbuilt, because the measured latency is well under the 300 ms budget and none of them removes the need for the API to authorise and publish. The one open measurement is the hop from a committed change in FastAPI to the edge, which waits for a staging API.

The event model has four rules.

1. Rooms are named `{kind}:{uuid}` and every Durable Object is `idFromName("{tenant}/{room}")`, so the tenant is part of the object identity and comes from the verified token. A topic never crosses tenants. There is no tenant-wide room, because no feature needs everyone in a workspace at once.
2. Events are `{kind, ids}` only: a dotted lowercase kind and up to eight named UUIDs. They never carry text, names or measurements, so no PHI travels on a socket. The client treats an event as a hint, refetches through the API and so applies every permission and blinding rule on the server. Clients send no events.
3. Only the API publishes, from a background task after the transaction commits, and a failed publish is logged and dropped. Presence is the one exception, because the room itself announces joins and leaves.
4. Every join, renewal and reconnect goes through `GET /api/rooms/{room}/access`, so the grant is rechecked at least every five minutes, and every reconnect refetches.

### Rooms as built

| Room | Who may join | Used for |
|---|---|---|
| `user:{user}` | Only that user | Worklist changes, notification arrival, and the index the edge uses to close sockets on removal |
| `task:{task}` | Anyone who can read the task | Changes to the shared annotation layer of a task |
| `slide:{slide}` | Anyone who can read the slide | Presence on the slide |
| `project:{project}` | Whole-project readers | Who views which slide, shown on the project page |

A case is a slide in a project, so it has no room of its own. What happens on a case reaches people through the slide room while they look at it, the task room while they work on a task and their own user room otherwise.

### Events as built

| Kind | Room | Ids | Publisher |
|---|---|---|---|
| `presence.joined`, `presence.left` | slide, project | user, and slide on the project room | The room itself on join and leave |
| `worklist.changed` | user, one per affected person | Task and related ids | Task, assignment, review state, ingest and change routes through `announce_worklist` |
| `layer.object-changed` | task | task, slide, annotation | The annotate layer routes through `announce` |

### Added by the remaining tasks

- Threads on task slides and mentions (COLLAB-002 and COLLAB-006, both done) do not publish yet. Their only path is the notification row, which the inbox reads by refetching.
- COLLAB-015 (threads on any slide), in progress, adds taskless threads. Thread events then need a room a taskless reader can join, so they go to the slide room, and to the task room as well when the thread has a task. The slide room keeps the first read rule: the event names a thread, the refetch decides what the reader sees. Planned kinds are `thread.changed` and `thread.message-added` with ids thread and slide.
- COLLAB-016 (calm live updates on a shared layer), in progress, consumes `layer.object-changed` and presence in the browser, batches them while the pointer moves and applies them after a pause or on the "changes by" marker. It adds no room and no kind.
- COLLAB-010 (follow my view) and COLLAB-011 (live shared cursor) are the first events sent by a client and at a high rate. They do not fit rule 2 as it stands. They need their own ADR when started, with a throttled client frame on the slide room, a size cap and no persistence. Until then clients still send nothing.
- COLLAB-008 (second opinion) and COLLAB-009 (guest view), both ideas that are not planned, would need a room token for a person without a workspace seat. That is a new join path and also needs its own ADR.

## Consequences

- A new feature picks a room by who must hear it, adds one kind and calls the same publish helper. It adds no table and no socket code.
- A missed event costs one stale screen until the next refetch or reconnect, which is acceptable for hints and not for cursors, so COLLAB-010 and COLLAB-011 must not reuse this loss rule unchanged.
- Because slide rooms fan out to everyone who can read the slide, an event must never imply what a reader may not see. Thread events name ids only and the first read rule applies on the refetch.
- The 551 ms outlier and the API to edge hop remain unmeasured against a staging API. TODO: repeat the spike once a staging API exists.
