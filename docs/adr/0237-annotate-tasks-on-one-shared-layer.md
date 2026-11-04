# 0237. Annotate tasks on one shared layer

- Date: 2026-11-04
- Status: Accepted
- Amended by: [ADR 0238](0238-check-options-and-presets-on-annotate-tasks.md) (check options and presets on annotate tasks)
- Deciders: owner, Claude
- Backlog: TASK-013, TASK-014, ANN-030, ANN-031, ANN-028, ANN-022, COLLAB-016, COLLAB-017, EVAL-013, EVAL-014, EVAL-015, AINUC-013, AINUC-014, AISEG-015, AISEG-016, JOBS-007, TASK-005, SHELL-004, PILOT-005

## Context

Parfocal's direction ([ADR 0053](0053-ai-results-review-direction.md), the AI results review direction) is a viewer where researchers evaluate AI results and doctors review them. On 2026-11-04 the owner widened it. Experts must also annotate slides to prepare data for training models, both from scratch on slides uploaded with no results and by checking and fixing AI output while they draw. Several experts work on the same slides, see what the AI made and what each colleague changed, and argue about it in threads.

The review task cannot hold this. [ADR 0078](0078-review-task-model.md) (review task model) makes `review_task_slides.result_set_id` required, so a slide with no results cannot be in a task. [ADR 0079](0079-reviewed-layer.md) (reviewed layer) gives each reviewer a private layer of edits, [ADR 0069](0069-slide-pipeline.md) (slide pipeline) derives Ready from a result set, and decisions, the review order, the disagreement queue and the evaluation metrics all compare a person with the AI.

Fable reviewed the model change on 2026-11-04, and the owner settled the product questions in the same session.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. A task kind, `review` or `annotate`, with the result set optional on annotate tasks | Review tasks stay as built, every consumer branches once on the kind | One migration and a kind check in each review-only endpoint |
| 2. A nullable result set with no kind | Smallest migration | Scope, order, decisions, queue and evaluation would each infer the kind from nulls per slide |
| 3. An empty result set made for the task | No schema change | The pipeline would call it imported, blinding would hide nothing and the evaluation would measure against nothing |
| A. One layer per expert, merged at the end | Independent opinions and agreement statistics | With everyone seeing everything it yields near-copies and an awkward merge |
| B. One shared layer per task slide, like a Figma file | One agreed truth per slide, which is what training needs, and arguments happen on the objects | Needs edit conflict protection and calm live updates |

## Decision

Option 1 with layer B.

- A task has a kind, `review` (the default, unchanged) or `annotate`. An annotate task may pin one ready result set per slide or none. It stores no review order, takes no decisions or opinion-form answers per object and has no disagreement queue. Review-only endpoints answer the problem code `not-a-review-task`.
- An annotate task snapshots the project classes (PROJ-004, class taxonomy per project) when it is made, so labels cannot drift while a dataset is built. Removing a class that task annotations use is refused.
- Every assigned expert edits one shared layer per task slide. Each object records who made it and who changed it, with its history. Editing or deleting an AI object copies it into the layer with its origin (`ai`, `ai-edited` or `human`) and its source object ID, so the result set stays immutable ([ADR 0076](0076-annotation-and-ai-result-storage.md), annotation and AI result storage). Saves carry a version, and a stale save is refused with a conflict.
- AI results on an annotate slide are shown by default, and each expert can hide them. Experts see each other's work from the start. Colleagues' changes arrive in calm batches when the expert pauses, or when they click a "changes by" marker, and never move a shape under the pointer. A task switch, "blind first", is off by default and keeps an expert's new objects from colleagues until that expert marks the slide checked.
- Any object can carry a thread, and objects show their origin and author.
- The one-click tools (AISEG), a model run on a selection and a whole-slide run that streams its objects onto the open slide work inside annotate tasks.
- An annotate slide is Ready when the slide is ingested. Each expert marks a slide checked, with "nothing to mark" when the slide is empty. The task owner signs a slide off once every assigned expert has checked it, with a warning for open threads. After sign-off the layer is locked, and later changes go to the change log ([ADR 0080](0080-disagreement-rule-and-sign-off.md), disagreement rule and sign-off).
- The export of a signed-off slide is GeoJSON of the shared layer, with each object's class, origin, author letter and full ID, plus a manifest of the slides, microns per pixel, the class snapshot, the annotators, the sign-off and a checksum per file. AI objects nobody deleted are exported with the origin `ai`. Patches with label masks come later.
- The evaluation of an annotate task summarises how the experts changed the AI per class: kept, edited, deleted and added objects, and by whom.

## Consequences

- One migration adds the kind, makes the result set nullable on annotate rows and stores the class snapshot. `review_states`, `review_tasks` and the review-only modules branch on the kind.
- [ADR 0053](0053-ai-results-review-direction.md), [ADR 0069](0069-slide-pipeline.md) and [ADR 0078](0078-review-task-model.md) still hold for review tasks, and this record adds annotate tasks beside them. [ADR 0079](0079-reviewed-layer.md) stays the model of review tasks only.
- The annotation path becomes the next milestone, MA, ahead of every unstarted task outside it, and [knowledge/agent-workflow.md](../knowledge/agent-workflow.md) lists it first in "Picking the next task". In order:
  1. The task and the layer: TASK-013 (annotate task kind), ANN-030 (shared layer API), ANN-022 (concurrent edit protection), ADJ-004 (sign-off as a soft lock) and TASK-014 (check and sign off an annotate slide).
  2. Drawing: ANN-002 (annotate rail), ANN-005 (polygon), ANN-008 (count marker), ANN-013 (undo), ANN-017 (proposals lifecycle), ANN-021 (autosave), SHELL-004 (Review and Annotate workspaces), ANN-031 (annotate task on screen) and ANN-028 (provenance display).
  3. Working together: COLLAB-007 (presence), COLLAB-003 (comment tool and pins), COLLAB-004 (thread popover), COLLAB-012 (open threads at submit and sign-off) and COLLAB-016 (calm live updates).
  4. One-click tools: AISEG-001 (ONNX export), AISEG-002 (quantised variants), AISEG-003 (model cache), AISEG-004 (inference worker), AISEG-012 (scale presets), AISEG-015 (patch reader), AISEG-011 (sub-pixel contours), AISEG-005 (smart select), AISEG-007 (prewarm) and AISEG-006 (hover preview).
  5. Model runs on the slide: AIP-006 (GPU worker pool), AIP-009 (resumable jobs), AINUC-001 (detector runner), AINUC-002 (typer runner), AINUC-005 (chunk paging), AINUC-013 (streaming onto the slide), JOBS-004 (job window), AINUC-010 (whole-slide job UI) and JOBS-007 (run on a selection).
  6. Output: TASK-005 (new task stepper), EVAL-013 (how the experts changed the AI), ANN-024 (GeoJSON export) and EVAL-014 (training dataset export), then PILOT-005 (second usability round).
- New tasks: TASK-013 (annotate task kind), TASK-014 (check and sign off an annotate slide), ANN-030 (shared layer API), ANN-031 (annotate task on screen), COLLAB-016 (calm live updates), COLLAB-017 (blind first switch), EVAL-013 (how the experts changed the AI), EVAL-014 (training dataset export), EVAL-015 (patches and masks), AINUC-013 (stream a whole-slide run onto the slide) and JOBS-007 (run a model on a selection in Annotate).
- An audit of the POC's annotation docs against the backlog on 2026-11-04 added AISEG-015 (browser patch reader), AISEG-016 (auto region fallback) and AINUC-014 (typing one-click accepts), merged its streaming task into AINUC-013, gave the AISEG tasks the dependency lines they lacked, and corrected AISEG-002, AISEG-005, AISEG-006, AINUC-001, AINUC-002, AINUC-008 and AINUC-010 to the POC's measured findings.
- Edited tasks: ANN-028 (provenance display), ANN-022 (concurrent edit protection), TASK-005 (new task stepper), SHELL-004 (Review and Annotate workspaces) and PILOT-005 (the usability study, now a second round with participants who are not pathologists).
- Agreement statistics between experts need independent work, so they apply only to tasks with "blind first" on, and are not built now.
