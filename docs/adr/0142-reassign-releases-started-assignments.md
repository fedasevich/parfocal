# 0142. A reassign deletes the first reviewer's untouched assignments and releases the started ones, which keeps their work under their name

- Date: 2026-11-02
- Status: Proposed
- Deciders: Yurii Fedas (to confirm)
- Backlog: TASK-007, TEAM-007, IAM-020

## Context

TASK-007 (nudge, reassign and change a task) lets the researcher move a reviewer's slides to someone else, either the slides not started (the default) or every slide. The decisions already given stay with the first reviewer's name and the new reviewer starts fresh. [ADR 0118](0118-blinding-and-a-kept-first-read.md) (blinding and a kept first read) says a reassign must never drop a recorded first read, and its trigger guards updates only.

Verdicts, opinions and reviewed-layer edits all point at the `(task, slide, user)` row in `review_assignments`, so a started row cannot be deleted without deleting the work.

## Options considered

1. A `released_at` marker on `review_assignments`. A started row stays with its work and its first read, is marked released, and counts as no assignment for access, My work, Home, progress, submits and disagreement completeness. The new reviewer gets a fresh row.
2. No marker. The first reviewer keeps the row, so the slide stays theirs to finish in My work and on Team, and the researcher sees them as behind after the hand-over.
3. Delete the row and move the work to the new reviewer. The foreign keys forbid it without moving rows, and it breaks "decisions stay with the first reviewer's name" and the kept first read.

## Decision

Option 1.

- A slide is started for a reviewer when it has a submit, a first read, a decision, a reviewed-layer edit, an opinion or an added object of theirs in that task. Moving it releases the row. Moving a slide that is not started deletes the row, because it holds nothing.
- Every query that grants a reviewer a slide or counts their open work filters `released_at IS NULL`. Owners still read the released reviewer's decisions, opinion and first read by reviewer id, and the evaluation and the disagreement queue still read every decision of the task.
- Each reassign is a row in `task_reassignments` with the slides it moved, and each nudge a row in `task_nudges`, so the Team screen's Undo can name them. `undoReassignment` moves the slides back while the new reviewer has not started any of them (409 `reassignment-started` after), and clears `released_at` on the first reviewer's kept rows, so they get their work back. `cancelNudge` deletes the nudge and its notification.
- The routes take the operation ids, paths and shapes of the PROTO-013 (Team) drafts, which are deleted, so the Team screen now calls the generated client.
- A reassign refuses the same person (400 `same-reviewer`), a target who already reviews one of the slides (409 `already-reviews-slide`), a target who is not a project owner or reviewer, and a source with no slides in the task (404 `not-on-task`). Signed-off tasks and archived projects refuse every change.
- Nudges, reassigns, added reviewers and due date changes are audited with pseudonyms of the people and never the message or note text, which lives only in the notification payload. New notification kinds are `task-nudged`, `task-reassigned` (sent to both people) and `task-due-changed` (sent to reviewers with slides left). An added reviewer gets `task-assigned`.

## Consequences

- Migration `0074` (task hand-over) adds the column, the two tables and the three notification kinds. It follows migration `0073` (import checks).
- Any later query that gives a reviewer slides, such as TEAM-007 (Team, the researcher's workload view) and IAM-020 (deactivation with hand-over), must filter released rows.
- TODO for the owner: whether the evaluation should leave out a released reviewer's decisions. Today it counts them, so a slide moved with "every slide" after decisions were given has one more reader in the evaluation than in the task.
