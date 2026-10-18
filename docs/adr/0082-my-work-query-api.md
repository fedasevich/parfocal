# 0082. My work is three read endpoints, one per tab, with keyset pages for All slides

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: WL-000, WL-001, WL-005, WL-017, HOME-001, REMOTE-001

## Context

My work replaces the worklist ([ADR 0053](0053-ai-results-review-direction.md)). POC doc 37 gives it three tabs: To review groups my tasks by project with progress and due date and opens the next slide in one click, Assigned by me shows each task's progress per reviewer, and All slides is a filterable table. WL-001 asks for one query API with filters by project, status, result set, reviewer and storage, and cursor pagination. Review states are derived by one pure function ([ADR 0069](0069-slide-pipeline.md), `parfocal_api.review_states`), and the disagreement queue is derived too ([ADR 0080](0080-disagreement-rule-and-sign-off.md)). There is no storage location on a slide yet, because connected sources are REMOTE-001.

## Options considered

1. One endpoint with a `tab` parameter. One route, but three different shapes behind one schema, and the generated client gets a union type.
2. Three endpoints, one per tab, each with its own response. Clear shapes, and each can be cached and paged on its own terms.
3. Store the derived states in a table and query that. Fast to filter, but every move and verdict must keep it in step, which ADR 0069 avoided on purpose.

## Decision

Option 2, computing states with the same pure functions.

- `GET /api/me/review-tasks` (To review) lists the tasks where I hold an assignment, newest due date first and tasks I have started before new ones. Each has its project, scope, due date, blinding, start mode, my slides submitted out of assigned, my verdict count, my status (`not-started`, `in-review`, `submitted` or `signed-off`) and the next slide to open, which is my first unsubmitted slide in task order.
- `GET /api/me/assigned-tasks` (Assigned by me) lists the tasks I created, with each reviewer's slides submitted out of assigned and state, and the task status: `not-started` (nobody has worked), `in-review`, `disagreements` (all submitted, queue not empty), `ready-to-sign-off` (all submitted, queue empty) or `signed-off`.
- `GET /api/me/slides` (All slides) lists every slide I can read, with project, case label, result sets and the reviews on it (task, reviewer and state), and its status: its state in the newest task it is in, or `ready`, `ai-running` or `uploaded` from its result sets when it is in no task. Filters are `project_id`, `status`, `result_set` (a model name), `reviewer_id` and a `q` search on slide and case labels. Pages are keyset pages over creation time and id, with an opaque cursor and at most 200 rows.
- The storage filter moves to REMOTE-001, which gives slides a source. WL-001 no longer asks for it.
- Object-level progress (37 of 50 cells) needs the scope's candidates, and cell scopes need the chunk summary in storage, so these lists count slides and verdicts. TODO: add object progress when result chunks reach storage.

## Consequences

- WL-001 builds the three endpoints and their API tests. WL-005 and WL-017 read them.
- `status` and `reviewer_id` are applied after the states are derived, so All slides reads every visible slide before paging. That is fine for the pilot's thousands of slides. TODO: revisit with option 3 if a workspace passes 50,000 slides.
- HOME-001 reuses the To review query for "your tasks".
