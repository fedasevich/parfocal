# 0276. Blind first on annotate tasks

- Date: 2026-11-09
- Status: Accepted
- Deciders: Claude
- Backlog: COLLAB-017, TASK-005, COLLAB-016

## Context

[ADR 0237](0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer) names a task switch, "blind first", off by default, that keeps an expert's new objects from colleagues until that expert marks the slide checked. Experts edit one shared layer per task slide, so the switch has to decide which rows of that layer a viewer gets, and how the realtime channel stays quiet about them.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Reuse `review_tasks.blinded` | No migration | It defaults to true and falls back to the project setting, so annotate tasks would be blind by default |
| 2. A new `blind_first` column, false by default, allowed only on annotate tasks | Off by default, one additive migration | One more column |
| A. Hide every object an unchecked expert made, AI copies included | Hides the most | AI copies have one row per AI object, so a colleague's edit of the same AI object would conflict and reveal it |
| B. Hide only hand-drawn objects (origin `human`) | No conflict on AI objects, check states and progress stay shared | Which AI objects an expert touched stays visible |

## Decision

Option 2 with rule B.

- `review_tasks.blind_first` is a boolean, false by default, set when the task is made and refused on review tasks.
- While it is on, a layer object is hidden from a viewer when its origin is `human`, the viewer did not make it, and its author holds an assignment on that slide that is not checked and not released. The task owner is a viewer like any other until the experts check.
- Hidden objects are left out of the shared layer list, the AI changes evaluation and the "nothing to mark" test. Their history, edit and delete answer 404 to anyone else.
- The rule follows the current check. Unchecking hides the expert's objects again.
- A change to a hidden object goes out as `layer.object-changed` on the author's user room, not the task room. Checking and unchecking a slide on a blind first task send `layer.visibility-changed` with the task, slide and user to the task room, so clients reload the layer.
- Exports need no change. The training dataset export takes signed-off slides only, and sign-off needs every expert checked.

## Consequences

- One additive migration adds the column and its check constraint.
- The task stepper's How it runs step has a working switch, and the Send step shows it.
- Agreement statistics between experts ([ADR 0237](0237-annotate-tasks-on-one-shared-layer.md)) can later be limited to blind first tasks.
- COLLAB-016 (calm live updates) should reload the layer on `layer.visibility-changed`.
- Threads anchored on a hidden object are not hidden. TODO if experts report that this leaks.
