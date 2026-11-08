# 0250. Confirmed AI objects as shared layer copies

- Date: 2026-11-08
- Status: Accepted
- Deciders: Claude
- Backlog: ANN-032

## Context

[ADR 0238](0238-check-options-and-presets-on-annotate-tasks.md) (check options and presets on annotate tasks) gives every AI object on an annotate slide a check state, unchecked, confirmed, edited or deleted, and says a confirmed object keeps its geometry and gets the origin `ai-confirmed`. [ADR 0239](0239-shared-layer-rows-in-the-annotations-table.md) (shared layer objects as rows of the annotations table) already copies an edited or deleted AI object into `annotations` with a source number, and the check scope counts any copy as checked. A confirm must also be undoable, and the app role cannot delete `annotation_versions` rows, so a confirm row cannot simply be removed.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. A confirm is a copy row with origin `ai-confirmed`, and an undo soft-deletes it | One table and one unique source index for every check state, history keeps the confirm and its undo, export reads the row like any other | A deleted `ai-confirmed` row means "unchecked again", unlike a deleted `ai-edited` row, which means "deleted" |
| 2. A separate table of confirmations keyed by object ID | A confirm needs no geometry copy | Export, evaluation and the check counts read two sources, and a confirmed object that is later edited moves between tables |
| 3. Hard delete the copy on undo | The layer holds only live copies | Needs delete rights on the append-only version table and loses who confirmed and undid |

## Decision

Option 1. Migration 0098 widens `annotations.origin` to 16 characters, adds `ai-confirmed` to its check and relaxes the source check to "every non-human row has a source number". No column, table or row is dropped.

- `POST .../shared-layer/ai/{object}/confirm` copies the AI object with its own outline, regions from `result_objects` and cells from the outline the client sends, as edits do. A cell without an outline is refused with `cell-shape-needed`. The copy has no class of its own, so it keeps the AI class.
- `DELETE .../shared-layer/ai/{object}/confirm?version=N` undoes a confirm by setting `deleted_at`. Anything else answers `not-confirmed`. A stale version answers `annotation-changed`.
- A confirm or an edit of an object whose confirm was undone revives the same row, because the unique source index allows one copy per AI object. The history then reads created, deleted and restored.
- Editing or deleting a confirmed copy through the shared object routes turns its origin into `ai-edited`, so a deleted copy always means a deleted object.
- The check states of the scope are: no copy or an undone confirm is unchecked, a live `ai-confirmed` copy is confirmed, a live `ai-edited` copy is edited and a deleted `ai-edited` copy is deleted. `GET .../check-status` returns these counts as `check_progress` once the slide's order is stored, and the sign-off rule counts an undone confirm as unchecked.
- After sign-off an owner's confirm or undo is logged as an `edited` change, so `evaluation_changes` keeps its three kinds.

## Consequences

- The shared layer read hides an undone confirm, so the client shows the AI object as unchecked again.
- The training dataset export (EVAL-014) must read `deleted_at` by origin. A deleted `ai-edited` row is a deletion and leaves the dataset, while a deleted `ai-confirmed` row is an unchecked object and follows the export option for unchecked objects.
- The confirm key is D in the annotate scope, because C draws a comment and the review decision letters would be shadowed when annotating inside a review.
