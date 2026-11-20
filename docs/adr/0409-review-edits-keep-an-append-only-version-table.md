# 0409. Review edits keep an append only version table beside the current layer

- Date: 2026-11-20
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-113 (every review edit keeps its history)

## Context

RSET-007 (the reviewed layer) and OBJ-003 (split, merge and added objects) keep one `review_edits` row per task, slide, reviewer and object. A save overwrites the row, an undo deletes it, and the audit entry `review.object-edited` names only the words retyped, reshaped or deleted. Who changed which shape, and from what, was lost. The owner's answers on the annotate, review and export path in `docs/decisions-answered.md` say that review and annotate tasks feed one training export, the adjudicator settles outlines, and the AI original must always stay recoverable. PROTO-116 (outlines that differ reach the disagreement queue) and PROTO-118 (a signed off review task becomes a final layer) need the steps between the AI original and the last save.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Put the geometry before and after into the audit entry | No migration | The audit trail is a hash chain for compliance, not a data store. Geometry would bloat every chain check and the export would read audit JSON |
| 2. Move review edits into `annotations` with `annotation_versions` | One versioning scheme for both task kinds | Rewrites RSET-007 and OBJ-003, their lineage of split parts and merged aliases, the disagreement code and every test, for no gain the export needs now |
| 3. Keep `review_edits` as the current layer and add an append only `review_edit_versions` table that every write path fills | One migration that only adds, current reads stay as they are, full history per object | A second table to keep in step, and the app role must be denied changes |

## Decision

Option 3.

- Migration 0143 creates `review_edit_versions` with the task, slide, reviewer, object (kind, number and split letters), the change, the class, the geometry and deleted flag after the change, the related objects and the time. A `sequence` identity orders rows, because `now()` is the same for every row of one transaction.
- The table is append only by grant. The migration revokes UPDATE, DELETE and TRUNCATE from the app role, as `annotation_versions` has only SELECT and INSERT. No trigger, because no purge path deletes review edits today. If a retention purge ever has to remove them, it runs as the table owner like `parfocal_retention_purge`.
- "Every save, clear, split and merge writes one row" is read as one row for every object the call changes, because history is read per object. A save writes `edited`. A clear writes `cleared` for each object it removes and `restored` for each split part or merged alias it brings back. A split writes `split` on the parent and `part` on each part. A merge writes `merged` on the keeper and `merged-into` on each alias. `related` names the other objects of that step.
- Each row copies the stored `review_edits` row after the change, not the request, so a retype of a reshaped object still carries its outline.
- `GET /api/review-tasks/{task}/slides/{slide}/edits/{object}/history` (`listReviewEditHistory`) is guarded like the reviewed layer. It returns the AI original first, read at request time from the never rewritten result set, then the rows of the object and of the objects it was split from, in order. The AI original is left out when blinding hides AI output from the caller.
- The rows keep a foreign key to the reviewer's assignment, the project and the tenant, but not to the project class, like `annotation_versions`. A class a reviewer once picked can still be removed, and old rows then keep its id.
- A slide with any history counts as started for reassignment, so an edit that was undone keeps the assignment (released, not deleted) and its rows stay valid.
- Rows are operational except `user_id`, which is personal and so appears in the person's data export like `review_edits`.
- The object card in the viewer lists the history once there is more than the AI original.

## Consequences

- Before and after of any edit are two rows, so PROTO-118 can export who changed what from which shape, and PROTO-116 can compare outlines between reviewers.
- Edits made before this migration have no rows. Their current state is still in `review_edits`.
- A merged keeper's history does not repeat the AI originals of its aliases. Each alias's own history has its AI original and its `merged-into` row.
- Erasing a person keeps the rows under the same user id, as for `review_edits`.
- A reviewer who edited a slide and undid it is no longer moved by a "not started" reassignment.
- A cell's AI original is read from its chunk file on each history request, and chunk reads are not cached.
