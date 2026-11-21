# 0413. The settled outline is a copy on the queue decision

- Date: 2026-11-21
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-117 (the adjudicator settles the shape)

## Context

Decision 167 (who settles two different outlines for one object) chose option A. The adjudicator, or the project owner in the queue, picks one reviewer's outline or draws a new one. ADR 0412 (outlines differ below a per task overlap of reviewers' redraws) puts such objects in the disagreement queue, but `disagreement_decisions` held an answer and a class and no geometry, and the consensus export took the earliest redraw.

## Options considered

- Where the shape lives. Columns on `disagreement_decisions`, a new table keyed by the same object, or a reference to the picked reviewer's row in `review_edits`. A reference follows the reviewer if they edit again and breaks when their assignment is released. A new table splits one decision over two rows. Columns keep the answer and the shape of one object in one row, which is what the owner asked for.
- A copy or a pointer for a pick. A copy of the reviewer's outline at pick time stays the same when that reviewer redraws later, and the export never has to join the edit history.
- Who and when. Reusing `decided_by_user_id` and `updated_at` mixes two acts that different people can do, so the shape gets its own columns.

## Decision

- Migration 0146 adds `outline`, `outline_from_user_id` (the picked reviewer, empty for a drawn outline), `outline_by_user_id` and `outline_at` to `disagreement_decisions`, with a validity check. It replaces the `decided_or_left_open` check with one that also allows a row holding only a settled outline. No data is dropped.
- `PUT` and `DELETE /api/review-tasks/{task}/disagreement-queue/{slide}/{object}/outline` serve the owner, refused while the object is with an adjudicator, while reviewers look again and after sign-off. `PUT` and `DELETE /api/review-tasks/{task}/adjudication/{slide}/{object}/outline` serve the adjudicator, who picks by the letter A or B and never receives a user id.
- A pick copies the reviewer's current outline in SQL. A drawn outline must be an area and passes the same shape checks as a review edit.
- The consensus export takes the settled outline first, then the earliest redraw, then the AI shape, and now lists agreed cells with their AI outline from the result chunks.
- Clearing an answer keeps a settled outline, and clearing the outline deletes a row left with nothing. The screens undo by putting back the previous outline.

## Consequences

- Settling the shape does not close a queue item. The owner or adjudicator still records an answer.
- An object decided without a settled shape still falls back to the earliest redraw in the export.
- Settling after sign-off is refused, the same as changing `outline_overlap`.
