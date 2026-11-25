# 0441. The layers tree is view organisation of the one shared layer

- Date: 2026-11-25
- Status: Accepted
- Deciders: Claude, with advice from Fable
- Backlog: PROTO-184 (drawn objects live in a Figma style layers tree). Builds on [ADR 0237](0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer, where an AI object is copied into the layer only when edited and the result set stays immutable) and on the saved layer groups of PROTO-066 (layer groups are saved and can be renamed, deleted and filled).

## Context

The owner found that the cells drawn in Annotate show as one long flat list whose rows cannot be clicked, next to a layers panel whose rows only take buttons. The two should be one tree that works like the layers panel in Figma: click to select and fly, Shift and Cmd to select many, drag to reorder and regroup, Cmd+G and Shift+Cmd+G, rename, show, hide and lock per row and per group, and stay fast with thousands of cells.

Three questions decide how later work treats the tree. How drawn shapes, AI objects and the class grouping fit one tree. What a group means for export, checks and sign-off. How the tree behaves with thousands of cells, given that the groups blob is saved whole on every change.

## Options considered

- Two lists, the flat object list and the layers panel, joined by buttons. This is what the owner found wanting.
- A tree that also holds every untouched AI object. Result sets stay immutable under ADR 0237 (annotate tasks on one shared layer), so their objects would need a second store of order and names, and a result set of 100 000 cells would swamp the list.
- Groups that change what is exported or signed off, so that a hidden group leaves the export. A reviewer could then remove work from a sign-off by hiding it, and every exporter would have to learn about groups.
- One tree of what the layer holds, where groups and per row settings only organise the view. Fable advised this on 2026-11-25.

## Decision

The layers tree is view organisation of the one shared layer: class groups are derived and never saved, saved groups, names, order, hide and lock live in the layer-groups blob, and nothing in the tree changes what is exported, counted or signed off.

- The tree shows what is in the layer, which is shapes drawn by hand and AI objects already copied into it. Untouched AI objects stay in their result set, which keeps its own row at the top of the panel, one row per result set.
- The top level holds the saved groups, nested by parent, then one class group per class for the shapes in no saved group, in the project's class order with No class last. Class groups are derived on every render and never saved, and they start collapsed. Hiding, locking, renaming or dropping into a class group first turns it into a saved group, then applies the change. Group by stays as the explicit way to make every bucket real.
- A saved group has an optional rank, and each shape has an optional sparse entry with a name, hidden, locked and rank. Both live in the layer-groups blob (`LayerGroup.rank`, `LayerGroups.items`, at most 20 000 items), so no migration is needed. On the slide route items pass through the same blinding as members, and the shared route stores them as sent. Ranks set the order in the tree only, never the paint order on the slide.
- Exports, checks and sign-off never read groups or items. A hidden or locked shape still exports, counts in checks and signs off. The own JSON export carries groups and items only so that a file round trips. A lock guards against accidental edits on the slide, and the sign-off lock overrides it. Hide and lock on a shared layer are shared, and the panel says how many objects sit in hidden layers.
- The tree is built by one pure pass (`treeRows` in `apps/web/src/annotations/layers-tree.ts`) that emits shape rows only for open groups, and it renders through a virtualiser with fixed 28 pixel rows. A group row click selects the group and flies to its bounds, and selects its members only when there are 200 or fewer. Selection stays owned by the select tool: a row click switches to it and asks it to pick. The groups blob saves 400 ms after the last change. Which groups are open is kept per user and per task or slide in local storage.
- In Annotate the measurement list keeps rulers only, because the tree owns the drawn shapes.

## Consequences

- A later feature that wants a group to mean something for review, such as exporting one group, needs its own ADR, because this one keeps groups out of every exporter.
- A new per row setting goes into the item entry of the blob, and its route must keep the blinding of members.
- A list of 5000 cells scrolls without a long frame, which the browser spec `layers-tree.spec.ts` checks.
