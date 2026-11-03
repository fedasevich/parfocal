# 0185. The smart minimap is one XState machine with a size mode, a fade flag and a peek overlay, placed by scoring the four corners

- Date: 2026-11-03
- Status: Proposed
- Deciders: Parfocal agents, owner to review
- Backlog: NAV-000 (research check for navigation aids). Sets the target for NAV-006 (smart minimap state machine), NAV-007 (minimap placement scoring), NAV-008 (minimap content), NAV-009 (minimap settings) and NAV-010 (whole-slide peek).

## Context

The design names the smart minimap in three places. The kit page "Interaction spec" has the frame "Spec / smart minimap states" with seven states and eight edges, a placement rule and the 300 ms move timing. The mock screen `navigator` ("A minimap that shows up where it helps and moves out of the way") has the four rules When, Scale, Where and Size, seven scenes and the functions `navSize`, `placeNav`, `navigator`, `readingNav` and `cellNav`. The Settings screen offers Minimap as When useful, Always or Never. [ADR 0143](0143-client-ui-state-zustand-and-xstate.md) already says the minimap is a real machine and gets XState.

What the code does today, read on 2026-11-03:

- `packages/ui/src/lib/minimap-box.ts` copies the mock's `navSize`: widths 196 (reading), 250 (travel), 150 (area, called `compact`) and 92 (locator, called `pip`), the map at most 1.25 times as tall as wide (92 px for the locator), plus 12 px of padding and 56, 34 or 12 px of header and footer.
- `apps/web/src/screens/viewer-tools/minimap-placement.ts` copies the mock's `placeNav` line for line, and `apps/web/test/viewer-tools.test.ts` covers the bottom right default, leaving a working corner and skipping a blocked one.
- `packages/ui/src/components/smart-minimap.tsx` draws the four sizes, fades to 28% opacity while the pointer is over the box, moves with a 300 ms transition on `left` and `top` and drops it under reduced motion.
- The scenes in `navigator-canvas.tsx`, `annotate-view.tsx` and `focus-view.tsx` pick the size and the hot points by hand per scene. No machine exists, `xstate` is not installed, and the full viewer passes `minimap={false}`.
- The magnification bar from NAV-001 (magnification bar) gives `magnificationBarRect`, which the scenes already feed in as a blocked rectangle.

## Options considered

| Option | For | Against |
|---|---|---|
| A flat machine with the seven kit states | Matches the kit drawing one to one | Faded and peek can happen in any state, so every state needs its own faded and peek copy or the machine forgets where to return |
| One machine with three parallel regions: size mode, fade, peek | Each region has few states, return targets are kept for free, model-based tests stay small | Reads differently from the kit drawing |
| Derive the state on every frame from camera and flags, no machine | Least code | No named states or guards to test, which NAV-006 asks for, and travel needs memory of where it started |

## Decision

One XState machine, `minimapMachine`, with three parallel regions. The kit edge "pointer near, any state" already says fade sits beside the other states, not among them.

**Mode region** (exactly one at a time):

| State | Size | Map extent | Entered when |
|---|---|---|---|
| `hidden` | none | none | more than half of the tissue is on screen |
| `reading` | 196 px, header and footer | whole slide with numbered areas, ticks and the seen trail | zoomed in so that half or less of the tissue is on screen, below 20x |
| `area` | 150 px, footer only | the current area padded by 12% of its longer side, cells still to check as dots | 20x and above |
| `locator` | 92 px, no header or footer, no badges | the current area | focus mode (one-cell review) is entered from `area` |
| `travel` | 250 px, header and footer, route line to the target | whole slide | G then n, or `]` |

Edges from the kit: `hidden` to `reading` on zoom in, `reading` to `area` past 20x, `area` to `locator` on focus mode, `locator` to `area` on Esc, `reading` to `travel` on G then n, `travel` to `reading` on arrival. The kit draws only these. The plain inverses follow from the same guards and NAV-006 builds them: `reading` to `hidden` when more than half the tissue is back on screen, and `area` to `reading` below 20x. A second `]` during travel skips to the target, as NAV-011 (travel animation and route line) says. TODO: the kit starts travel only from `reading`. Whether G then n from `area` or `locator` also enters travel is left to NAV-006 to settle with the owner.

**Fade region**: `clear` or `faded`, faded at 28% opacity while the pointer is within 40 px of the box. A click on a faded map still opens the peek.

**Peek region**: `closed`, `held` or `latched`, as NAV-010 (whole-slide peek) specifies: hold Z opens it, a tap under 350 ms latches it until Z, Esc or a click. `usePeekKey` in `slide-peek.tsx` already does this with the key registry, so the machine takes its events instead of reading keys itself.

**Setting**: When useful runs the machine as above. Always replaces `hidden` with `reading`. Never renders no map, but the machine and the Z peek still run.

**Placement**, run each time the mode, the canvas size or the hot points change, and kept as the pure function `placeMinimap` that exists:

1. Compute the box from the mode and the extent with `minimapBox`.
2. Put a candidate in each corner 12 px from the canvas edges, with a preference of 0 for bottom right, 0.5 bottom left, 1 top right and 1.5 top left.
3. Grow each candidate by 10 px on every side. Add the weight of each hot point inside it and 1000 for each blocked rectangle it overlaps.
4. Take the lowest score. The preferences make bottom right win any tie.

Hot points and weights, from the mock: points along the tumor edge in view at 3 each, the current cell at 50, other cells still to check at 4, and a measurement in progress sampled at 11 points along the line at 200 each. Blocked rectangles: the magnification bar at its current size, the edge cues, the display legend and, in focus mode, the cell card. The canvas sits below the top bar, so the top bar never needs a block.

**Motion**: a new corner animates for 300 ms with an ease and is instant under reduced motion. While the camera pans or zooms the corner is held, and the new placement is applied when the camera rests.

## Where the code and the design disagree

| Gap | Design | Code today | Follow-up |
|---|---|---|---|
| Fade distance | within 40 px of the pointer | only while the pointer is over the box | NAV-006 |
| No move while panning | never while panning | placement is recomputed every frame | NAV-007 |
| Hot points in the cells scene | current cell 50 plus every cell to check at 4, legend blocked | current cell only, no legend block | NAV-007 |
| Kit inputs with no weight in the mock | open thread, floating cells panel, proposals and pins | none | NAV-007 chooses weights and records them here or in a new record |
| Minimap setting | When useful, Always, Never, default When useful | the catalogue now says `useful`, `always` or `never`, default `useful`, and `shownMinimap` in `minimap-box.ts` applies it | done in NAV-009 |
| When useful text | appears once half or less of the tissue is on screen | Settings help says "once you zoom past the whole slide" | NAV-009 |
| Full viewer | the map shows in the full viewer | `full-viewer.tsx` passes `minimap={false}` | NAV-006 |
| Guided review | the kit gives the smart minimap to the full viewer only | `slide-still.tsx` draws its own fixed 136 px map top right | NAV-006 decides whether guided review moves to `SmartMinimap` |

## Consequences

- NAV-006 adds `xstate` and `@xstate/react`, checking versions then, and writes the machine with model-based tests over every edge above. The machine says which mode, extent and fade apply. Placement stays a pure function the machine does not own.
- The tissue share on screen needs a tissue mask or the seen-trail grid. The spec says "about half" and gives no hysteresis. TODO: NAV-006 measures whether the map flickers at the threshold and adds a margin only if it does.
- Seen tissue counts only at 10x and above, as the kit says. That rule belongs to the seen trail in NAV-008 (minimap content), not to the machine.
- NAV-006, NAV-007, NAV-008 and NAV-009 now reference this record.
