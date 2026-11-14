# 0302. A shared cursor is a second capped client frame, sent as shares of the slide

- Date: 2026-11-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: COLLAB-011 (live shared cursor in compare and follow modes). Extends [ADR 0301](0301-a-shared-camera-is-a-capped-client-frame-relayed-by-the-slide-room.md) (a shared camera is a capped client frame relayed by the slide room) and [ADR 0269](0269-realtime-event-model-by-room-and-kind.md) (realtime event model by room and kind)

## Context

COLLAB-011 (live shared cursor) shows a colleague's pointer on the slide while one person follows another, and in compare. ADR 0301 (shared camera frame) left room for a second frame type on the same relay. The open choices were whether the cursor rides inside the view frame or in its own frame, which unit it travels in, and who sends it. The live engine works in slide pixels and compare draws a 1600 by 1000 still, so a pixel unit of either screen is wrong on the other.

## Decision

1. The frame is `{type: "cursor", x, y}`, where `x` and `y` are the pointer's share of the slide width and height, rounded to five decimals, or `{type: "cursor", gone: true}`. It carries no text, name or id.
2. The slide room relays it exactly as it relays a view frame: only on `slide:` rooms, stamped with `user` from the seat, to the unexpired sockets of other users, stored and logged nowhere.
3. A cursor frame longer than 96 characters or with a missing or non finite number is dropped. Each socket may relay 30 cursor frames a second, counted apart from its 30 view frames, so pointer traffic can never starve the camera.
4. The browser sends at most one cursor frame every 50 ms with the last point always sent, sends nothing while the point is unchanged, and sends one `gone` frame when the pointer leaves the stage. A camera change under a resting pointer sends the new point.
5. Only a person who shares their view sends a cursor. On the live slide a follower sees only the cursor of the person they follow. Compare sends nothing and draws the cursor of everyone sharing on the room of its session slide, on the pane that shows that slide, and carries it to the other panes by the link offsets of [ADR 0271](0271-linked-compare-panes-keep-a-per-pane-offset.md) (linked compare panes keep a per pane offset), behind the existing "Shared cursor" switch.
6. A shown cursor is removed on a `gone` frame, on a view stop frame, on `presence.left` of its sender and on the viewer's own reconnect.

The alternative of packing the cursor into the view frame was rejected because the two change at different times and one rate cap would then serve both.

## Consequences

- The room accepts two kinds of client input, each with its own size and rate cap. It is still not a general message bus.
- A share of the slide lands on the same tissue for any window size, zoom or still size. Five decimals is about one slide pixel on a 100 000 pixel slide.
- Compare has no "Share my view" control, so a person in compare can see a colleague's pointer and cannot send their own. The question is in `docs/decisions.md`.
- The blinded review question of ADR 0301 now also covers the cursor. TODO: decide whether blinded tasks hide sharing.
- In a flipped compare pane the name beside the cursor is mirrored with the pane. TODO: draw the label outside the flipped box.
- Unit tests cover the caps and the throttle, and a two page test on the fake room over BroadcastChannel shows the follower's marker within 2 px of the sharer's pointer. TODO: measure the deployed relay between two browsers.
