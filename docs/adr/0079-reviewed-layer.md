# 0079. The reviewed layer is one edit row per task, reviewer and AI object, plus task annotations for added objects

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: RSET-007, OBJ-003, GUIDE-001, TASK-004, RSET-008, ADJ-001

## Context

RSET-007 records reviewer edits (retype, outline, delete, add) per reviewer in a layer over the AI set, so the AI output is never overwritten and can be compared with what reviewers made of it. [ADR 0072](0072-verdicts-reasons-and-opinion-forms.md) keys verdicts by task, reviewer, slide and object, and saves a `wrong_class` reason together with a retype in this layer. [ADR 0077](0077-result-sets.md) made result sets immutable, and [ADR 0078](0078-review-task-model.md) pins one result set per task slide. People already add regions and cells as annotations with a person mark ([ADR 0076](0076-annotation-and-ai-result-storage.md)). Cells live in chunk files, so the database cannot list every cell number of a set.

## Options considered

1. Copy the AI set per reviewer and let them edit the copy. Simple to read, but a million cells per reviewer is far too much, and the comparison has to diff two full copies.
2. Store only what a reviewer changed, one row per task, reviewer, slide and object, and keep added objects as annotations tagged with the task. Small, keyed like verdicts, and the comparison is the edit rows themselves.
3. Store edits as annotation versions. Annotations are slide-wide and shared, while the layer is private to one reviewer in one task.

## Decision

Option 2.

- `review_edits` holds, per task, slide, reviewer, object kind (`region` or `cell`) and number, the new class, the new outline and a deleted flag. A row needs at least one of them. Saving replaces the row, and clearing it (undo) deletes it. Each save and clear writes `review.object-edited` or `review.object-restored` to the audit log.
- An edited region must exist in the task slide's result set. A cell number must be at most the slide's last cell number from `slide_counters`, because the database cannot see inside chunks. Outlines follow the annotation rules: a region is a polygon or multipolygon, and a cell a polygon or point.
- Added objects are annotations of kind `region` or `cell` with the new `task_id` column, so they carry the person mark (T⁺, C⁺) and share the slide's counters ([ADR 0071](0071-object-id-grammar.md)). Only the reviewer assigned to that task slide adds them there.
- Only the assigned reviewer edits their own layer. A project owner reads every reviewer's layer, and a reviewer reads only their own until TASK-004 (blinding) decides what they see after submitting.
- `GET .../layer` returns the edits, the added objects and a comparison with the set: how many regions and cells the set has, and how many were retyped, reshaped, deleted and added.
- Edits are refused once the task is signed off. TODO: wire that check when ADJ-004 (sign-off) stores sign-off records, after the owner settles ADJ-000.

## Consequences

- The AI set never changes, which the tests prove by reading `result_objects` and `result_sets` before and after every kind of edit.
- GUIDE-001 saves a `wrong_class` verdict and the retype in one transaction through this layer.
- RSET-008 exports a reviewed layer by applying the edits to the set and adding the task annotations.
- OBJ-003 (split, merge) adds split suffixes to `review_edits` and aliases, on top of this table.
- ADJ-001 compares layers between reviewers through the same rows.
