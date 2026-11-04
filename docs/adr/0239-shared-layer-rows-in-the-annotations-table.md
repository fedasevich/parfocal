# 0239. Shared layer objects as rows of the annotations table

- Date: 2026-11-04
- Status: Accepted
- Deciders: Claude
- Backlog: ANN-030

## Context

[ADR 0237](0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer) gives every annotate task slide one layer that all assigned experts edit. Each object records who made and changed it with its history, an edited or deleted AI object is copied into the layer with its origin and source object ID, and saves carry a version. [ADR 0076](0076-annotation-and-ai-result-storage.md) (annotation and AI result storage) already keeps human objects as PostGIS rows in `annotations` with the append-only `annotation_versions` table, a version per row and a `task_id`.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Rows of `annotations` with an `origin` and a `source_number` | Reuses numbering, versions, history, shape checks and the export path, one migration of two columns | The generic annotation table carries two columns only task layers use |
| 2. A new `layer_objects` table with its own version table | Layer rows stand apart from free annotations | Duplicates numbering, history and shape checks, and every later reader (export, evaluation) needs a second source |
| 3. Per expert rows like `review_edits`, merged on read | Mirrors the reviewed layer | ADR 0237 rejected one layer per expert |

## Decision

Option 1. The migration adds `origin` (`human` or `ai-edited`) and `source_number` to `annotations`, with a partial unique index on task, slide, kind and source number so an AI object is copied into a layer once. The source object's letter is the row's kind, and the result set is the one the task slide pins.

- A deleted AI object is a copy with `deleted_at` set, the deletion mark, and stays in the layer read so the client hides the AI object. A deleted human object leaves the layer read and keeps its history.
- A region copy takes its outline from `result_objects` when the request sends none. AI cells live only in chunks, so a change to an AI cell sends the cell's outline, and without one it is refused with `cell-shape-needed`.
- "Who changed it" is the author of the latest version row, so no new personal column is added.
- A stale save, or a second copy of an AI object already in the layer, answers `annotation-changed` with the current object in the problem's `current` field.
- Every change publishes `layer.object-changed` with the task, slide and object IDs on the task room, because the edge knows only slide, task and user rooms. A task slide room can be added when calm live updates (COLLAB-016) need it.

## Consequences

- The export of a signed-off slide (ANN-024) and how the experts changed the AI (EVAL-013) read one table, where AI objects nobody copied keep the origin `ai`.
- Reading the cell outline from chunks on the server would let a cell deletion send no outline. It is not built now.
