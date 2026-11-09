# XXXX. Linked compare panes keep a per-pane offset in slide pixels, log2 zoom and degrees

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: CMP-000 (compare research check). Records the linking model that CMP-002 (linked views), CMP-003 (shared cursor), CMP-005 (rotation support) and CMP-006 (semi-automatic alignment) built, and what the remaining compare work adds

## Context

Compare shows up to four slides at once (CMP-001, split viewer layouts). A pathologist compares serial sections or an H&E slide with its IHC stain, so the same tissue sits at a different position, scale and angle on each slide. Panes must move together while the user explores, and the user must be able to fix a misalignment by hand and keep it. CMP-000 asked for the model to be written down before more compare features lean on it.

## Decision

Each pane has a view of four numbers: the slide point at the pane centre in slide pixels (x and y), zoom as log2 of the scale, and rotation in degrees. The state lives in the pure `LinkedViews` model in `packages/viewer-engine/src/camera/linked-views.ts`, with a `linked` flag, one view per pane and one offset per pane. An offset has the same four numbers and is the difference between a pane and the shared view.

- While linked, moving any pane computes the shared view by subtracting that pane's offset, then gives every other pane the shared view plus its own offset. Pan, zoom and rotation all travel this way, so the offsets stay fixed.
- Unlinking only clears the flag. Panes then move alone and the offsets are kept as they were.
- Relinking recomputes every offset as the difference between each pane and a reference pane, which is the left pane. Whatever the user lined up by hand while unlinked becomes the new offset, so relinking keeps the manual alignment instead of snapping panes back together.
- Offsets are plain additions with no shared centre of rotation. Zoom adds in log2 so a zoom offset is a fixed ratio. When panes are rotated against each other the slide-pixel offset is not turned with them, which is exact for small offsets and drifts only when an offset is large and the rotation differs.
- Shift+L toggles linking through the `linkviews` action in the compare scope of the key registry. Shift+L is also the arrow tool in Annotate, which is why the action has its own scope.
- Rotate left, rotate right and reset act on a pane in 15 degree steps and wrap to the range minus 180 to 180. Linked panes turn together, unlinked panes alone, and pointer and touch input never rotate a pane, because rotation is off by default for input devices.
- The shared cursor maps a hovered slide point to the other panes by adding the difference between their offsets, then draws it through each pane's own zoom, rotation and mirroring (`cursor-map.ts`). The Shared cursor switch hides it.
- Line up automatically (CMP-006) matches downsampled tissue density of the two overviews over rotation and shift, converts the best match into an offset and rotation for the right pane, and writes it through the same offset. Clear sets all offsets back to zero while keeping the reference view. It is rigid only, so a mirrored section is not handled, and it gives no proposal for a blank or unrelated pair.
- Mirroring is a display flip of one pane and is not part of the linked view, so it never changes an offset.
- Four-pane layouts link all four panes against the left one. Automatic alignment moves the right pane only and leaves the bottom two alone.

## Alternatives

- A single shared camera with no offsets was rejected. Serial sections are never at the same position, so every pane would need a per-pane transform anyway.
- Storing absolute positions per pane and re-deriving offsets on every move was rejected. It drifts when a pane is zoomed at its edge, and fixed offsets are simpler to test.
- A full affine or non-rigid registration per pane pair was rejected for now. Serial sections differ by a rigid move in nearly every case, and a richer transform would need its own editing controls.
- Turning offsets with the pane rotation (a true rigid transform about the centre) is a possible later step and is not needed while offsets stay small.

## Consequences

- Linked behaviour is a pure function with unit tests that cover offsets, relink and rotation, so the screen holds no linking maths.
- Offsets are not saved. Reopening a pair starts with no offset and the user lines up again. Remaining compare work may store an offset per slide pair so the alignment survives between sessions, and that needs an owner choice (below).
- The mock still feeds one overview to both panes, so the alignment is tested on synthetic pairs only. Real serial sections still need a measured tolerance result before alignment is described to users.

## Open question

Should an aligned offset be saved per pair of slides? Recommended: yes, as a private per-user setting that is cleared when either slide is replaced, so a second look at the same pair starts aligned and nothing is shared across users.
