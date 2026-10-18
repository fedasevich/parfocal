# 0078. A review task pins one result set per slide, stores assignments from its split, and opens task slides to their reviewers

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: TASK-001, TASK-002, TASK-003, TASK-004, TASK-007, RSET-009, PROJ-008

## Context

TASK-001 asks for a task with a name, a project, slides or cases, a result set, reviewers, a split (everyone reviews all, split evenly, chosen per slide), a scope, an opinion form version, blinding, the start mode, a due date and reminders. A result set belongs to one slide ([ADR 0077](0077-result-sets.md)), so "the result set" of a task with many slides is really one set per slide. [ADR 0069](0069-slide-pipeline.md) stores assignments, with `submitted_at`, and derives the other states. [ADR 0065](0065-project-role-enforcement.md) left project reviewers with no slides until tasks exist, and annotation writes for reviewers wait for them ([knowledge/api.md](../knowledge/api.md)). POC doc 37 calls blinding a project setting that is on by default, and lists the scopes as all objects, a random sample of N, objects below a confidence threshold, objects inside ROIs and the unsure zones.

## Options considered

1. One result set id on the task. Only works for single-slide tasks, or forces every slide to share a set id, which they cannot.
2. One result set per task slide, chosen explicitly or by model name (the newest ready set of that name on each slide). Works for any number of slides and keeps the choice visible per slide.
3. Store the split as a rule and compute assignments on read. Saves rows, but [ADR 0069](0069-slide-pipeline.md) needs `submitted_at` per assignment, and reassigning one slide (TASK-007) would rewrite the rule.

## Decision

Option 2 for result sets and stored assignments for the split.

- `review_tasks` holds the project, a per-project number (shown as `RT-14`), the name, the split, the scope kind and its parameters, the opinion form version, `blinded` (default on), `ai_hidden_first_read` (default off), the start mode (`guided` or `viewer`), the due date, reminder offsets in days before the due date (at most three), the author, and archive and timestamps.
- `review_task_slides` holds each slide with the result set it is reviewed against. A set must be `ready`, not deleted and on that slide. A request names slides or cases (a case adds all its slides) and either one result set per slide or a model name, which picks the newest ready set of that name on each slide. A slide without a matching set is refused with its label.
- `review_assignments` holds one row per task, slide and reviewer, with `submitted_at` (null until TASK-008). The split makes them: everyone gets every slide, an even split deals slides in slide order to reviewers in the given order so the counts differ by at most one, and a chosen split takes an explicit list of slide and reviewer pairs. Every reviewer must be a project owner or project reviewer, and in a chosen split every slide needs at least one reviewer.
- Scope kinds are `all-regions`, `random-cells` with `count` (1 to 10,000) and a `seed` fixed when the task is made, so every reviewer gets the same sample (TASK-003), `cells-below-score` with `score` (0 to 1), `inside-rois` and `unsure-zones`.
- The opinion form version defaults to the project's current version and must exist.
- Editing a task changes its name, scope, blinding, start mode, due date and reminders. Changing slides or reviewers is TASK-007, because it moves assignments. Each create and edit writes an audit entry (`task.created`, `task.changed`).
- Access: a project reviewer reads a slide, its case, its annotations and its result sets only when they hold an assignment on that slide in a task that is not archived. They draw annotations on those slides too. A project owner reads and does everything in the project. Blinding itself is TASK-004.

## Consequences

- `project_access` gains a slide-level check used by the slide, annotation and result set routes, and `readable` lets reviewers list the cases that hold their task slides. The permission matrix test's `NEEDS_A_TASK` set shrinks, because reviewers can write once assigned.
- TASK-002 derives states from `review_assignments` and the other stored facts, and TASK-003 samples cells from the stored seed.
- RSET-009 counts tasks through `review_task_slides`.
- Project-level defaults for blinding and the first read (doc 37) belong to PROJ-008 (project settings). Until then a task defaults to blinded with the AI shown.
