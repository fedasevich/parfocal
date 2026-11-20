# 0412. Outlines differ below a per task overlap of reviewers' redraws

- Date: 2026-11-21
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-116 (reviewers' outlines that differ reach the disagreement queue)

## Context

Decision 167 (who settles two different outlines for one object) chose option A. The adjudicator settles different outlines, outlines count as different below a set overlap that can be changed per task, and the starting value is measured. Before this, two reviewers who agreed on the class but redrew the outline differently left nothing in the disagreement queue. ADR 0409 (review edits keep an append only version table) keeps every reviewer's outline in `review_edits`.

## Options considered

- The measure. Intersection over union, the share of the smaller shape covered, or the largest boundary distance (Hausdorff). Intersection over union is symmetric, needs no pixel size, is what `SAME_ADDED` in the evaluation already uses, and PostGIS computes it in one query.
- Where the threshold lives. Inside the task's `display` JSON, inside `check_options`, or a new column. `display` is validated as display defaults with no extra keys, and `check_options` exists only for annotate tasks, so neither fits. A new `review_tasks.outline_overlap` column (migration 0144) holds a whole percent from 1 to 99.
- What is compared. Every reviewer's final outline including the AI outline for those who did not redraw, or only the outlines reviewers drew. AI cell outlines live in chunk files, and the queue is built in about fifteen places that have no result store. Reading chunks there would slow every queue, home and sign-off call.

## Decision

- An object joins the disagreement queue when two reviewers who both submitted the slide redrew it and the lowest pairwise intersection over union of their current outlines (`split` empty, not deleted, not retired, assignment not released) is below the task's `outline_overlap` percent.
- The starting value is 60%, measured in [the outline overlap result](../results/2026-11-21-outline-overlap-threshold.md).
- The reason is `outlines-differ` with the queue tag `outline`, shown as "outline differs". When the decisions already queue the object for another reason, that reason stays and the row carries `outline_differs` with the overlap.
- The queue row lists each reviewer's outline, and the card draws them in their own colours over the AI outline with a legend that names each reviewer.
- `PATCH /api/review-tasks/{task}` takes `outline_overlap`, refused with `outline-overlap-signed-off` after sign-off.

## Consequences

- One reviewer redrawing while the other keeps the AI outline is not an outline disagreement yet. Covering it needs the AI cell outline next to the queue, for example a stored copy at redraw time.
- The value is a proxy from AI fixture outlines and app tolerances, not from human pairs. It should be revisited once real redraws exist.
- The anonymous adjudicator view does not carry the outlines yet. PROTO-117 (the adjudicator settles the shape) adds them with the chosen geometry.
- There is no settings control for the value yet, only the API field.
