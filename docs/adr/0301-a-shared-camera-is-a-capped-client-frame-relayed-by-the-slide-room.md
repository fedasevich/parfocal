# 0301. A shared camera is a capped client frame that the slide room relays and never stores

- Date: 2026-11-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: COLLAB-010 (follow my view). Extends [ADR 0269](0269-realtime-event-model-by-room-and-kind.md) (realtime event model by room and kind), which said this task needs its own ADR

## Context

COLLAB-010 (follow my view) lets a person share their live camera so that others on the same slide can follow it until they move. ADR 0269 (realtime event model by room and kind) lets only the API publish, as `{kind, ids}` hints that every screen answers with a refetch. A camera that moves many times a second cannot go through the API and a refetch, and a lost hint there costs a stale screen, which is wrong for a moving view. The alternatives were a publish route on the API for every camera step, a second socket or room only for views, a peer to peer channel, and a frame the client sends on the slide room socket it already holds for presence.

## Decision

The client sends a view frame on the slide room socket and the room relays it. Nothing else changes in ADR 0269: every other event still comes from the API and clients send no other frame that reaches anyone.

1. The frame is `{type: "view", x, y, zoom}` with three finite numbers in the engine's camera units, or `{type: "view", stop: true}`. It carries no text, name or id, so no PHI travels on it.
2. Only `slide:` rooms relay it. The room stamps `user` from the seat of the sending socket, so a client cannot speak for someone else, and sends it to the unexpired sockets of other users in the same room. The sender's own sockets do not get it back.
3. A frame longer than 160 characters, with a missing or non finite number, or from an expired seat is dropped without an answer. Each socket may relay 30 frames a second, counted in memory, and the rest are dropped.
4. The room stores nothing and logs nothing for a view frame. A hibernated room that wakes has no view state to restore.
5. The loss rule is that the next frame replaces a lost one. The sharer sends at most one frame every 50 ms while the camera moves, with the last position always sent, one frame every 5 s while still, one when anyone joins the room and one after a reconnect. Sharing ends for a follower on a stop frame, on `presence.left` of the sharer or on the follower's own reconnect.
6. In the browser, sharing and following exclude each other, and a follower never sends the cameras it applies, so two people cannot drive each other. A follower stops following on the first camera change that is not the one just applied.

The button to share and the buttons to follow sit beside the presence avatars on the live slide. They show only where the live engine is on screen.

## Consequences

- The room now accepts one kind of client input. The size cap, the rate cap and the slide room limit keep it from becoming a general message bus. COLLAB-011 (live shared cursor) can reuse the same relay with its own frame type and caps.
- The camera is in slide units and zoom, so followers with a different window size see the same centre and magnification and a different extent.
- Whoever can join the slide room can follow a shared view. In a blinded review this shows where a colleague looks. Decision 98 (whether a blinded task hides "Share my view") chose A on 2026-11-14: while the reader is blinded on the slide, which means an assigned reviewer who has not submitted it in a blinded task or has not recorded the first read, the browser hides sharing and following, sends no camera or cursor frame and applies none. The room still relays to that reader, because the seat carries no task and no blinded claim. TODO: enforce it in the room with the signed claim that SEC-040 (presence in a blinded task) needs. TODO: a slide opened without a task in the address gives the browser no task to check.
- The two page test on the fake room over BroadcastChannel shows every follower step inside 300 ms on one machine. TODO: measure the deployed relay between two browsers once this reaches the deployed edge, against the 53 to 63 ms median of [the realtime latency result](../results/2026-11-02-realtime-transport-latency.md).
- A sharer who closes the tab without a stop frame is removed for followers by `presence.left`.
