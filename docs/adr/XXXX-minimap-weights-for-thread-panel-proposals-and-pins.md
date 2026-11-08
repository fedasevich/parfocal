# XXXX. The minimap scores proposals at 5, pins at 20, and treats an open thread and the cells panel as blocked

- Date: 2026-11-08
- Status: Accepted
- Deciders: Parfocal agents, owner (decision 38 asked NAV-007 to pick the missing weights)
- Backlog: NAV-007 (minimap placement scoring). Closes the gap named in ADR 0185 (the smart minimap state machine and placement).

## Context

The mock scores a corner by its preference plus the weight of each hot point under it. It gives 3 for a tumor edge point, 50 for the current cell, 4 for other cells still to check and 200 for each of 11 points along a measurement. It gives no weight to an open thread, the floating cells panel, proposals or pins.

## Decision

- Proposals from the auto region pass weigh 5 each. The annotate scene already used 5, so the number only moves into a named constant.
- A pin weighs 20. A pin is something the reader placed on purpose, so it ranks above a proposal and below the current cell at 50, which is where the reader is looking.
- An open thread and the floating cells panel are blocked rectangles at 1000, like the magnification bar. They are text panels that the map would hide, and a heavy but finite weight would still let the map land on them when every corner is busy.
- Other cells to check weigh 4 in the cells scene, as the mock does.
- The weights live in one file, `apps/web/src/screens/viewer-tools/minimap-weights.ts`, and the unit tests pin their order.
- The corner is held while the camera pans or zooms and is applied 200 ms after the camera rests, then the 300 ms move runs.

## Consequences

- Changing a weight is one edit plus a test update.
- Each scene lists its own hot points and blocks, so a new overlay needs a line in its scene to count.
