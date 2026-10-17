# 0069. The slide pipeline is derived from stored facts, and people move only submit, reopen and sign-off

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: TASK-000 (research check for review tasks), shapes TASK-001 (review task model), TASK-002 (slide states per task and reviewer), TASK-008 (submit a slide review), ADJ-001 (disagreement detection), ADJ-004 (sign-off), EVAL-003 (exports), JOBS-001 (model runs) and RSET-001 (result sets)

## Context

POC [doc 37](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/37-ai-results-review-rework.md) "Pipeline" shows a slide in a task moving from uploaded, through AI running or imported, ready, assigned, in review and submitted, to the disagreement queue, signed off and exported. [ADR 0057](0057-no-case-state-machine.md) removed the hospital case state machine and said the slide pipeline per task replaces it. The states sit at different levels: a slide is uploaded once, a result set is imported or run per slide, a reviewer submits per slide, and a task is signed off as a whole. One stored state column cannot say all of that, and a stored copy of something that can be computed goes stale.

## State of the art

Python state machine libraries such as `transitions` and `python-statemachine` model one object with one current state and callbacks on each move. The POC and the reverted case machine used a plain table of allowed moves and a pure function, which was easy to test with every allowed and refused move ([ADR 0038](0038-case-state-machine.md)). Review tools such as Cytomine and QuPath projects keep facts (annotations, reviews, timestamps) and show status computed from them, rather than a workflow engine. No library is needed here.

## Options considered

1. A stored state per task, slide and reviewer, moved by events through one table, as the case machine did. Every system event (an import finishing, the AI finishing) would have to find and move rows in every task that holds the slide, and the rows go wrong when an event is missed.
2. Store only the facts people and jobs create, derive every shown state from them with one pure function, and keep a table of the moves people make. System states follow from the slide, its result sets and jobs, and cannot disagree with them.

## Decision

Option 2.

| State | Level | Stored or derived | Who or what moves it |
|---|---|---|---|
| Uploaded | Slide | Stored: the slide row exists and its ingest status (INGEST-017) | The upload or import (INGEST, REMOTE) |
| AI running | Slide and result set | Derived: a model run for the task's result set is queued or running (JOBS-001) | The job system |
| Imported | Slide and result set | Derived: the task's result set on that slide finished importing (RSET-001) | The import |
| Ready | Slide in a task | Derived: the slide is published and the task's result set on it is complete | Nobody, it follows |
| Assigned | Task, slide and reviewer | Stored: an assignment row created from the task's split (TASK-001) | The researcher, by creating or changing the task (TASK-007) |
| In review | Task, slide and reviewer | Derived: the reviewer saved a first verdict, opinion answer or comment on that slide in that task. Opening the slide alone does not count | Nobody, it follows the reviewer's work |
| Submitted | Task, slide and reviewer | Stored: `submitted_at` on the assignment, cleared on reopen | The reviewer submits (TASK-008) and may reopen until the task is signed off |
| Disagreement queue | Task and slide | Derived: every assigned reviewer has submitted and ADJ-001 found disagreements without a decision | Leaves the queue when the researcher or an adjudicator decides every queued object (ADJ-002, ADJ-003) |
| Signed off | Task | Stored: a sign-off record with the evaluation version (ADJ-004) | The project owner, confirmed by signing in again. The owner may reopen it |
| Exported | Task | Derived: an export of the signed-off evaluation exists (EVAL-003) | The export |

Moves people make, which TASK-002 tests as a table with every allowed and refused case:

| Move | From | To | Actor |
|---|---|---|---|
| Submit | Assigned or in review | Submitted | The assigned reviewer |
| Reopen a review | Submitted, task not signed off | In review | The same reviewer |
| Sign off | The task as a whole | Signed off | A project owner |
| Reopen a task | Signed off | Not signed off | A project owner |

Rules that follow:

- The state shown for a slide in a task is the earliest state of its reviewers until all have submitted, then the task-level state. The researcher sees each reviewer's state as well.
- A reviewer who is removed from a slide (TASK-007) loses the assignment. Their saved verdicts stay in the record, but no longer count towards progress.
- Every stored move writes an audit entry (`task.review-submitted`, `task.review-reopened`, `task.signed-off`, `task.reopened`). Derived states write nothing.
- The pure function takes the facts and returns the states, so TASK-002, TASK-003 (progress) and My work (WL) share one definition.
- When sign-off is allowed (for example only when every slide is submitted and the queue is empty) and what it locks is decided by ADJ-000 (research check for disagreements and sign-off). TODO: the owner should confirm that rule there.

## Consequences

- TASK-001 creates `review_tasks` and `task_assignments` (task, slide, reviewer, `submitted_at`). TASK-002 adds the pure state function and the move table.
- JOBS-001 and RSET-001 must expose whether a result set on a slide is queued, running, failed or complete, because Ready depends on it.
- A failed model run or import keeps the slide out of Ready. TODO: TASK-002 decides how a failed result set shows (a separate "failed" mark rather than a pipeline state).
- No state machine library is added.
