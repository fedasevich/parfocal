# 0238. Check options and presets on annotate tasks

- Date: 2026-11-04
- Status: Accepted
- Deciders: owner, Claude
- Backlog: TASK-015, ANN-032, GUIDE-019, TASK-013, TASK-014, TASK-005, EVAL-013, EVAL-014, JOBS-007

## Context

[ADR 0237](0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer) exported every AI object nobody deleted with the origin `ai`. A whole-slide run can place hundreds of thousands of cells, and an expert who marks a slide checked has not looked at each one, so the dataset could be mostly the model's own guesses. Nothing in an annotate task pointed experts at the AI's weakest objects either, because the least sure first order (GUIDE-012, [ADR 0117](0117-review-order-is-stored-per-task-slide.md)) existed only in review tasks.

The owner asked on 2026-11-04 for one flexible task that covers every research setup: a whole-slide run checked by experts, AI on selected areas rechecked by an expert, experts annotating by hand with fast tools, and any mix, with the least sure first order available throughout.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. More task kinds, one per setup | Each kind stays simple | Setups mix in practice, and every kind multiplies screens and tests |
| 2. Annotate tasks gain check options, and the new task stepper offers presets that set them | One model covers every setup, and a preset is only a starting point the researcher can change | The options need clear defaults and a summary in the stepper |

## Decision

Option 2.

- Every AI object on an annotate slide has a check state: unchecked, confirmed, edited or deleted. One key confirms an object, and editing or deleting it also counts as checked. A confirmed object keeps its geometry and gets the origin `ai-confirmed`.
- A task's check options are:
  - the check scope, the scope kinds of TASK-012 (a task scope as a list of kinds), such as all AI objects, objects below a score, a random sample of N or objects inside drawn regions;
  - the check order, least sure first (the GUIDE-012 order, stored per task slide) or by position. By position follows the slide, not the object IDs, because IDs follow the processing tiles. Objects are grouped into bands one chunk grid high (2048 level 0 pixels) by their centre, each band runs left to right and the next right to left, and the object ID breaks ties;
  - the sign-off rule, which either requires every object in the check scope to be checked or only warns;
  - the export of unchecked AI objects, left out (the default) or included with the origin `ai-unchecked`.
- Objects that a model run inside the task adds, on a selection or the whole slide, join the check scope as they land.
- A guided check steps through the scope in the task's order inside the Annotate workspace, with confirm, fix and delete on keys, and leaves the drawing tools at hand for what the AI missed.
- The new task stepper offers presets that only fill in the options:
  - "Annotate by hand" has no result set and no check scope;
  - "Check a whole-slide run" checks every AI object least sure first and requires all to be checked;
  - "Check a sample" checks a random sample least sure first, and the rest stays unchecked and out of the export. The researcher sets the sample size, the preset only prefills 200, and the sample is drawn with a seed stored on the task so it stays the same between loads and after other options change;
  - "Fix AI on selected areas" checks objects inside the drawn regions;
  - "Mixed" checks AI least sure first and lets experts draw what it missed.
- Review tasks are unchanged.

## Consequences

- The export of [ADR 0237](0237-annotate-tasks-on-one-shared-layer.md) changes. Origins are `human`, `ai-confirmed`, `ai-edited` and, only when the task includes them, `ai-unchecked`. The manifest records the check options and how many AI objects were left out.
- The review order job (GUIDE-013) runs for annotate tasks that have a check scope.
- New tasks: TASK-015 (check options and presets), ANN-032 (check state on AI objects) and GUIDE-019 (guided check in Annotate). Edited tasks: TASK-013 (annotate task kind), TASK-014 (check and sign off an annotate slide), TASK-005 (new task stepper), EVAL-013 (how the experts changed the AI), EVAL-014 (training dataset export) and JOBS-007 (run a model on a selection in Annotate).
- The check options join step 1 of the annotation path in [ADR 0237](0237-annotate-tasks-on-one-shared-layer.md), after TASK-013, and GUIDE-019 joins step 2 after ANN-031.
