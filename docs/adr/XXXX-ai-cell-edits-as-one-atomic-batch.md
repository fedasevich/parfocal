# XXXX. Edits of AI cells go to the shared layer as one atomic batch

- Date: 2026-11-18
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-035 (experts edit any imported or seeded cell, its outline and its type)

## Context

[ADR 0237](0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer) and [ADR 0258](0258-confirmed-ai-objects-as-shared-layer-copies.md) (confirmed AI objects as shared layer copies) say that an edit of an AI object copies it into the shared layer and never rewrites the result set. The API had one route per object, `PUT .../shared-layer/ai/{object}`, which refused an object that already had a copy. On screen an AI cell could only be picked from a list, so its type and outline could not be changed on the slide, and a lasso over hundreds of cells had no way to save as one step.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. One request per cell through the existing routes | No new route | A lasso of 252 cells is 252 requests, a failure in the middle leaves half of them changed, and undo has to track which ones landed |
| 2. One batch route that changes many AI objects in one transaction | One request and one undo step per gesture, a stale version refuses everything, the same route serves a first edit and a later one | A second write path beside the single object routes |
| A. Put AI cells into the drawing document and its undo history | One history for everything | The save queue would store every AI cell as a hand-drawn object, and a slide with 100,000 cells would live in the document |
| B. A separate history of AI edits, with Cmd+Z going to whichever side changed last | The drawing document and its save queue stay as they are | Two histories, ordered by time |

## Decision

Option 2 with history B.

- `POST .../shared-layer/ai-changes` takes up to 5,000 changes, each with the object ID, and optionally a type, an outline, `deleted` and the version of an existing copy. An object with no copy, or with an undone confirm, gets a copy with origin `ai-edited`. An object with a live or deleted copy is rewritten when the version matches. One stale version answers `annotation-changed` and nothing is saved. An object may appear once per batch.
- A change with `deleted` false on a deleted copy brings it back. "Restore the AI original" and undo both send the earlier type and outline as a new version of the copy. The copy is never removed, because a deleted `ai-edited` copy means a deleted object.
- No migration. The result set tables and files are only read.
- On screen the Select tool picks AI cells by click, marquee and Alt+drag lasso, by centre point. Class keys retype the selection, X or Delete removes it, J and Shift+J step through cells in reading order, Enter or a double-click shows at most 32 handles.
- AI edits keep their own history of 200 steps, one step per batch. Cmd+Z undoes an AI edit when it is newer than the last change of the drawing document, and otherwise undoes the drawing.

## Consequences

- The single object route stays for older clients and the guided check uses the batch route.
- Undo of a first edit leaves a copy that equals the AI original, so the check state stays "edited". That matches the advice to keep the copy and its history.
- The batch loops per object in one transaction. 5,000 cells are several thousand statements, which is acceptable for a rare gesture and can become set-based later.
- The fake API's seeded cells moved onto the slide. They lay outside its bounds before, so they could not be seen or clicked in the live viewer.
